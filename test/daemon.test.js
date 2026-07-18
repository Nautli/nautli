import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { STATUS } from "../src/core/schema.js";
import { runOnce } from "../src/daemon/pipeline.js";
import { judgePairs } from "../src/daemon/judge.js";
import { findPairs } from "../src/daemon/pair.js";
import { applyJudgments } from "../src/daemon/apply.js";
import { writeReport } from "../src/daemon/report.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockJudge = path.join(root, "test", "fixtures", "mock-judge.js");
const retryJudge = path.join(root, "test", "fixtures", "retry-judge.js");
process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";
process.env.NAUTLI_JUDGE_RETRY_DELAY_MS = "1";
const config = {
  default_scope: "person",
  judge_cmd: [process.execPath, mockJudge],
  triage_cmd: false, // 트리아지 게이트 off — 이 파일은 judge/apply 게이트만 검증
  contradiction_auto: true, // 자동 무효화 메커니즘 자체를 테스트 (제품 기본값은 false=리뷰카드)
};

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-daemon-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

function add(store, claim, scope, t_valid, confidence = 0.8) {
  return remember(store, { claim, scope, t_valid, confidence }, config);
}

test("daemon applies confidence gates and is journal-idempotent", async (t) => {
  const { home, store } = isolatedStore(t);
  const duplicateOld = add(store, "고신뢰중복 메모 alpha", "project:duplicate", "2025-01-01", 0.7);
  const duplicateNew = add(store, "고신뢰중복 메모 alpha 기록", "project:duplicate", "2025-02-01", 0.9);
  const contradictionOld = add(store, "서비스 포트는 3000", "project:port", "2025-01-10");
  const contradictionNew = add(store, "서비스 포트는 4000", "project:port", "2025-03-10");
  const reviewA = add(store, "검토중복 메모 beta", "project:review", "2025-01-01");
  const reviewB = add(store, "검토중복 메모 beta 기록", "project:review", "2025-02-01");
  const unrelatedA = add(store, "무관판정 메모 gamma 왼쪽", "project:unrelated", "2025-01-01");
  const unrelatedB = add(store, "무관판정 메모 gamma 오른쪽", "project:unrelated", "2025-02-01");

  const first = await runOnce(store, home, config, { dry: false });
  assert.equal(first.pairs, 4);
  assert.deepEqual({
    applied: first.applied,
    queued: first.queued,
    shadowed: first.shadowed,
    skipped: first.skipped,
    machine_oracle: first.machine_oracle,
  }, {
    applied: 2,
    queued: 0,
    shadowed: 1,
    skipped: 1,
    machine_oracle: 0,
  });
  assert.equal(store.getFact(duplicateOld.id).status, STATUS.SUPERSEDED);
  assert.equal(store.getFact(duplicateOld.id).superseded_by, duplicateNew.id);
  assert.equal(store.getFact(contradictionOld.id).status, STATUS.INVALIDATED);
  assert.equal(store.getFact(contradictionOld.id).t_invalid, "2025-03-10");
  assert.equal(store.getFact(contradictionNew.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(reviewA.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(reviewB.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(unrelatedA.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(unrelatedB.id).status, STATUS.ACTIVE);

  // Zero-touch: mid-confidence duplicates are shadowed in undo ledger, not queued
  const queueExists = fs.existsSync(path.join(home, "review", "queue.jsonl"));
  if (queueExists) {
    const queue = fs.readFileSync(path.join(home, "review", "queue.jsonl"), "utf8").trim();
    assert.equal(queue, "");
  }

  const reports = fs.readdirSync(path.join(home, "reports"));
  assert.equal(reports.length, 1);

  const second = await runOnce(store, home, config, { dry: false });
  assert.equal(second.pairs, 0);
  assert.equal(second.applied, 0);
  assert.equal(second.queued, 0);
  assert.equal(second.machine_oracle, 0);
});

test("failed judgments stay observable without completing or applying the pair", (t) => {
  const { home, store } = isolatedStore(t);
  const oldFact = add(store, "재시도 중복 메모", "project:failed-apply", "2025-01-01", 0.7);
  const newFact = add(store, "재시도 중복 메모 최신", "project:failed-apply", "2025-02-01", 0.9);
  // findPairs는 같은 밀리초에 생성된 무작위 id도 사전순으로 정규화한다.
  const pair_id = [oldFact.id, newFact.id].sort().join(":");
  const judgment = {
    pair_id,
    verdict: "duplicate",
    confidence: 0.95,
    // newer는 이제 승자 방향의 정본 — 정렬 순서와 무관하게 newFact를 가리키게 계산한다
    newer: pair_id.split(":")[1] === newFact.id ? "b" : "a",
    reason: "같은 사실이다.",
  };

  const failed = applyJudgments(store, [{ ...judgment, failed: true }], config);
  assert.equal(failed.failed_pairs, 1);
  assert.equal(failed.applied, 0);
  assert.equal(failed.queued, 0);
  // findPairs의 completed 집계도 judgment_failed를 무시해야 다음 소화에 쌍이 다시 올라온다
  assert.ok(findPairs(store).some((pair) => `${pair.a.id}:${pair.b.id}` === pair_id));
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
  assert.equal(fs.existsSync(path.join(home, "review", "queue.jsonl")), false);

  const journalFile = path.join(home, "daemon", "journal.jsonl");
  const firstJournal = fs.readFileSync(journalFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(firstJournal.length, 1);
  assert.equal(firstJournal[0].kind, "judgment_failed");
  assert.equal(firstJournal[0].outcome, "failed");

  const retried = applyJudgments(store, [judgment], config);
  assert.equal(retried.failed_pairs, 0);
  assert.equal(retried.applied, 1);
  assert.equal(store.getFact(oldFact.id).status, STATUS.SUPERSEDED);
  assert.equal(store.getFact(oldFact.id).superseded_by, newFact.id);
  const finalJournal = fs.readFileSync(journalFile, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(finalJournal.map((entry) => entry.kind), ["judgment_failed", "judgment"]);
});

test("report renders approval cards and machine oracle summary", (t) => {
  const savedLang = process.env.NAUTLI_LANG;
  process.env.NAUTLI_LANG = "ko";
  t.after(() => {
    if (savedLang === undefined) delete process.env.NAUTLI_LANG;
    else process.env.NAUTLI_LANG = savedLang;
  });
  const { home, store } = isolatedStore(t);
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  const claims = {
    a: "원문 A는 npm 발행 대기 상태다",
    b: "원문 B는 npm 발행 완료 상태다",
  };
  fs.writeFileSync(queueFile, `${[
    {
      pair_id: "fa_crux_a:fa_crux_b",
      verdict: "contradiction",
      confidence: 0.88,
      newer: "b",
      reason: "npm 발행 상태가 서로 다르다.",
      crux: "npm 발행이 끝났는지가 갈려요.",
      claims,
      status: "pending",
    },
    {
      pair_id: "fa_fallback_a:fa_fallback_b",
      verdict: "duplicate",
      confidence: 0.72,
      newer: null,
      reason: "표현이 비슷한 기술 판정 문장이다.",
      claims: { a: "fallback 원문 A", b: "fallback 원문 B" },
      status: "pending",
    },
  ].map(JSON.stringify).join("\n")}\n`, "utf8");

  const result = writeReport(store, home, {
    applied: 0,
    queued: 2,
    skipped: 0,
    machine_oracle: 1,
    failed_pairs: 2,
  });
  const report = fs.readFileSync(result.file, "utf8");

  assert.match(report, /요약: 적용 0건, 리뷰 대기 추가 2건, 건너뜀 0건, 기술 기록 보류 1건\./u);
  assert.match(report, /\(판정 2쌍은 일시 오류로 건너뜀: 다음 소화 때 다시 시도해요\)/u);
  assert.match(report, /\(기술 기록 보류: 정답이 레포나 로그에 있는 갈림이라 사람에게 묻지 않았어요\)/u);
  assert.match(report, /\*\*npm 발행이 끝났는지가 갈려요\.\*\*/u);
  assert.match(report, /질문: 지금은 어느 쪽이 맞나요\? \(A \/ B \/ 둘 다 \/ 모름\)/u);
  assert.match(report, /데몬 추천: B가 최신으로 보여요 \(확신 88%\)/u);
  assert.match(report, /\*\*이 두 기억이 같은 내용 같아요\.\*\*/u);
  assert.doesNotMatch(report, /\*\*표현이 비슷한 기술 판정 문장이다\.\*\*/u);
  assert.match(report, /질문: 하나로 합칠까요\? \(O \/ X \/ 모름\)/u);
  assert.match(report, /참고\(원문\)\n- A: 원문 A는 npm 발행 대기 상태다\n- B: 원문 B는 npm 발행 완료 상태다/u);
  assert.equal(report.match(/원문 A는 npm 발행 대기 상태다/gu)?.length, 1);
  assert.ok(report.indexOf("원문 A는 npm 발행 대기 상태다") > report.indexOf("참고(원문)"));
  assert.match(report, /판정: contradiction 0\.88 · pair: fa_crux_a:fa_crux_b · 이유: npm 발행 상태가 서로 다르다\./u);
});

test("judge command rejects script and eval forms and gates node behind test env", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "judge 명령 검증 왼쪽", "project:judge-command", "2025-01-01");
  const b = add(store, "judge 명령 검증 오른쪽", "project:judge-command", "2025-02-01");
  const pair = { a: store.getFact(a.id), b: store.getFact(b.id) };
  for (const judge_cmd of [
    ["claude", "/tmp/arbitrary-script.js"],
    ["claude-patched", "--eval", "process.exit()"],
    ["claude", "-e", "process.exit()"],
  ]) {
    const result = await judgePairs([pair], store, { judge_cmd }, home);
    assert.equal(result.errors.length, 1);
  }
  const allowance = process.env.NAUTLI_ALLOW_TEST_JUDGE;
  delete process.env.NAUTLI_ALLOW_TEST_JUDGE;
  try {
    const result = await judgePairs([pair], store, { judge_cmd: [process.execPath, mockJudge] }, home);
    assert.match(result.errors[0].reason, /NAUTLI_ALLOW_TEST_JUDGE/);
  } finally {
    process.env.NAUTLI_ALLOW_TEST_JUDGE = allowance;
  }
});

test("judge raw stdout and stderr are redacted and capped per line", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "judge 로그 검증 왼쪽", "project:judge-log", "2025-01-01");
  const b = add(store, "judge 로그 검증 오른쪽", "project:judge-log", "2025-02-01");
  const script = path.join(home, "secret-judge.js");
  fs.writeFileSync(script, [
    'import readline from "node:readline";',
    'process.stderr.write("api_key=abcdefghijklmnopqrstuvwxyz0123456789 Bearer bearer-secret-value\\n" + "A".repeat(3000) + "\\n");',
    'const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});',
    'for await (const line of lines){if(!line.trim())continue;const input=JSON.parse(line);process.stdout.write(JSON.stringify({pair_id:input.pair_id,verdict:"related",confidence:0.5,newer:null,reason:"sk-abcdefgh12345678"})+"\\n");}',
  ].join("\n"), "utf8");
  const result = await judgePairs([{ a: store.getFact(a.id), b: store.getFact(b.id) }], store, {
    judge_cmd: [process.execPath, script],
  }, home);
  assert.equal(result.parsedCount, 1);
  const raw = fs.readFileSync(path.join(home, "daemon", "judge-raw.log"), "utf8");
  assert.match(raw, /\[REDACTED\]/);
  assert.doesNotMatch(raw, /abcdefghijklmnopqrstuvwxyz0123456789|bearer-secret-value|sk-abcdefgh12345678/);
  assert.ok(raw.split("\n").every((line) => Buffer.byteLength(line) <= 2048));
});

test("judge retries once after a non-zero batch exit and keeps the successful result", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "judge 재시도 왼쪽", "project:judge-retry", "2025-01-01");
  const b = add(store, "judge 재시도 오른쪽", "project:judge-retry", "2025-02-01");
  const counterFile = path.join(home, "judge-retry-count");
  const previousCounter = process.env.NAUTLI_JUDGE_RETRY_COUNTER_FILE;
  process.env.NAUTLI_JUDGE_RETRY_COUNTER_FILE = counterFile;
  t.after(() => {
    if (previousCounter === undefined) delete process.env.NAUTLI_JUDGE_RETRY_COUNTER_FILE;
    else process.env.NAUTLI_JUDGE_RETRY_COUNTER_FILE = previousCounter;
  });

  const result = await judgePairs([{ a: store.getFact(a.id), b: store.getFact(b.id) }], store, {
    judge_cmd: [process.execPath, retryJudge],
  }, home);

  assert.equal(fs.readFileSync(counterFile, "utf8"), "2");
  assert.equal(result.parsedCount, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.judgments.length, 1);
  assert.equal(result.judgments[0].verdict, "related");
  assert.equal(result.judgments[0].failed, undefined);
  assert.match(fs.readFileSync(path.join(home, "daemon", "judge-raw.log"), "utf8"), /RETRY \(Judge exited with 1\)/u);
});

test("judge batch failure includes stderr in errors array for health.log diagnostics", async (t) => {
  const { home, store } = isolatedStore(t);
  const alwaysFailJudge = path.join(root, "test", "fixtures", "always-fail-judge.js");
  const a = add(store, "stderr 전파 검증 왼쪽", "project:stderr-test", "2025-01-01");
  const b = add(store, "stderr 전파 검증 오른쪽", "project:stderr-test", "2025-02-01");

  const result = await judgePairs([{ a: store.getFact(a.id), b: store.getFact(b.id) }], store, {
    judge_cmd: [process.execPath, alwaysFailJudge],
  }, home);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].reason, /Judge exited with 1/u);
  assert.ok(result.errors[0].stderr, "stderr field should be present in error");
  assert.match(result.errors[0].stderr, /rate limit exceeded/u);
  assert.equal(result.judgments.length, 1);
  assert.equal(result.judgments[0].failed, true);
});

test("judge_cmd ending with bare -p gets the default prompt injected (config specifies binary/model only)", async () => {
  const { command, JUDGE_PROMPT } = await import("../src/daemon/judge.js");
  const resolved = command({ judge_cmd: ["claude-patched", "--model", "sonnet", "-p"] });
  assert.equal(resolved.cmd, "claude-patched");
  assert.equal(resolved.args[resolved.args.length - 1], JUDGE_PROMPT);
  assert.throws(() => command({ judge_cmd: ["claude", "-p", ""] }), /프롬프트가 필요/);
  assert.throws(() => command({ judge_cmd: ["rm", "-p"] }), /허용되지 않은 judge_cmd/);
});
