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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockJudge = path.join(root, "test", "fixtures", "mock-judge.js");
process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";
const config = {
  default_scope: "person",
  judge_cmd: [process.execPath, mockJudge],
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
  assert.deepEqual({ applied: first.applied, queued: first.queued, skipped: first.skipped }, {
    applied: 2,
    queued: 1,
    skipped: 1,
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

  const queue = fs.readFileSync(path.join(home, "review", "queue.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, "pending");

  const reports = fs.readdirSync(path.join(home, "reports"));
  assert.equal(reports.length, 1);
  const report = fs.readFileSync(path.join(home, "reports", reports[0]), "utf8");
  assert.ok((report.match(/^## 리뷰 카드/gm) ?? []).length <= 3);

  const second = await runOnce(store, home, config, { dry: false });
  assert.equal(second.pairs, 0);
  assert.equal(second.applied, 0);
  assert.equal(second.queued, 0);
  assert.equal(fs.readFileSync(path.join(home, "review", "queue.jsonl"), "utf8")
    .trim().split("\n").length, 1);
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

test("judge_cmd ending with bare -p gets the default prompt injected (config specifies binary/model only)", async () => {
  const { command, JUDGE_PROMPT } = await import("../src/daemon/judge.js");
  const resolved = command({ judge_cmd: ["claude-patched", "--model", "sonnet", "-p"] });
  assert.equal(resolved.cmd, "claude-patched");
  assert.equal(resolved.args[resolved.args.length - 1], JUDGE_PROMPT);
  assert.throws(() => command({ judge_cmd: ["claude", "-p", ""] }), /프롬프트가 필요/);
  assert.throws(() => command({ judge_cmd: ["rm", "-p"] }), /허용되지 않은 judge_cmd/);
});
