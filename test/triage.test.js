import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { applyJudgments } from "../src/daemon/apply.js";
import { writeReport } from "../src/daemon/report.js";
import { triageCards, triagePendingQueue } from "../src/daemon/triage.js";
import { listUndoLedger } from "../src/core/review.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockTriage = path.join(root, "test", "fixtures", "mock-triage.js");
process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";
process.env.NAUTLI_LANG = process.env.NAUTLI_LANG || "ko";
const config = {
  default_scope: "person",
  triage_cmd: [process.execPath, mockTriage],
};

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-triage-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

function add(store, claim, scope = "project:triage") {
  // remember()는 {id, status}만 반환 — claim까지 든 전체 fact를 돌려준다
  return store.getFact(remember(store, { claim, scope }, config).id);
}

function card(pairId, a, b, extra = {}) {
  return {
    pair_id: pairId,
    verdict: "contradiction",
    crux: "두 기록의 상태가 갈려요.",
    reason: "서로 다른 상태를 말한다.",
    claim_a: a.claim,
    claim_b: b.claim,
    scope: a.scope,
    ...extra,
  };
}

test("machine triage skips the human queue and journals skipped_triage", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "기술 기록 빌드는 대기 상태다");
  const b = add(store, "기술 기록 빌드는 완료 상태다");
  const pairId = `${a.id}:${b.id}`;
  const triaged = await triageCards([card(pairId, a, b)], config, home);

  assert.equal(triaged.get(pairId)?.route, "machine");
  const result = applyJudgments(store, [{
    pair_id: pairId,
    verdict: "contradiction",
    confidence: 0.8,
    newer: "b",
    reason: "빌드 상태가 다르다.",
    oracle: "user",
    ...triaged.get(pairId),
  }]);

  assert.equal(result.queued, 0);
  assert.equal(result.triage_routed, 1);
  assert.equal(fs.existsSync(path.join(home, "review", "queue.jsonl")), false);
  const journal = fs.readFileSync(path.join(home, "daemon", "journal.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
  assert.equal(journal[0].outcome, "skipped_triage");
  const report = writeReport(store, home, result);
  const text = fs.readFileSync(report.file, "utf8");
  assert.match(text, /AI가 대신 맡음 1건/u);
  assert.match(text, /\(AI가 대신 맡음: 사람이 답할 필요 없는 질문이라 보류해 뒀어요\)/u);
});

test("human triage keeps crux_plain and report uses it as the headline", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "개인 선호는 속도를 가장 중요하게 생각한다");
  const b = add(store, "개인 선호는 안정성을 가장 중요하게 생각한다");
  const pairId = `${a.id}:${b.id}`;
  const triaged = await triageCards([card(pairId, a, b)], config, home);
  const result = applyJudgments(store, [{
    pair_id: pairId,
    verdict: "contradiction",
    confidence: 0.8,
    newer: null,
    reason: "중요하게 여기는 기준이 다르다.",
    crux: "두 기록의 상태가 갈려요.",
    oracle: "user",
    ...triaged.get(pairId),
  }]);

  assert.equal(triaged.get(pairId)?.route, "human");
  // Zero-touch: contradictions are shadowed, not queued
  assert.equal(result.shadowed, 1);
  assert.equal(result.queued, 0);
  // crux_plain is propagated to the judgment
  assert.equal(triaged.get(pairId)?.crux_plain, "앞으로 어떤 방식을 더 중요하게 생각하는지 확인이 필요해요.");
});

test("missing triage output fails open into the human queue", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "파싱 실패 개인 선호 A");
  const b = add(store, "파싱 실패 개인 선호 B");
  const pairId = `${a.id}:${b.id}`;
  const triaged = await triageCards([card(pairId, a, b)], config, home);

  assert.equal(triaged.has(pairId), false);
  const result = applyJudgments(store, [{
    pair_id: pairId,
    verdict: "duplicate",
    confidence: 0.7,
    newer: null,
    reason: "비슷해 보인다.",
    oracle: "user",
  }]);
  // Zero-touch: no human queue, shadowed instead
  assert.equal(result.shadowed, 1);
  assert.equal(result.queued, 0);
  assert.equal(result.triage_routed, 0);
});

test("triagePendingQueue routes machine cards and enriches human pair and capture cards", async (t) => {
  const { home, store } = isolatedStore(t);
  const machineA = add(store, "기술 기록 자동 실행은 꺼져 있다", "project:machine");
  const machineB = add(store, "기술 기록 자동 실행은 켜져 있다", "project:machine");
  const humanA = add(store, "개인 선호는 빠른 출시다", "project:human");
  const humanB = add(store, "개인 선호는 완성도다", "project:human");
  const machinePair = `${machineA.id}:${machineB.id}`;
  const humanPair = `${humanA.id}:${humanB.id}`;
  const capture = {
    pair_id: "capture_1",
    type: "capture",
    status: "pending",
    claim: "중요한 사업 결정은 창업자가 확인한다",
    scope: "project:capture-human",
    project: "/tmp/capture-human",
    confidence: 0.8,
    crux_plain: "예전에 만든 질문이에요.",
    context_plain: "예전에 만든 배경이에요.",
    recommend: "dismissed",
    recommend_reason_plain: "예전에 만든 추천 이유예요.",
  };
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  fs.writeFileSync(queueFile, `${[
    {
      pair_id: machinePair,
      verdict: "contradiction",
      crux: "자동 실행 상태가 갈려요.",
      reason: "상태가 다르다.",
      claims: { a: machineA.claim, b: machineB.claim },
      status: "pending",
    },
    {
      pair_id: humanPair,
      verdict: "contradiction",
      crux: "우선순위가 갈려요.",
      reason: "선호가 다르다.",
      claims: { a: humanA.claim, b: humanB.claim },
      status: "pending",
    },
    capture,
  ].map(JSON.stringify).join("\n")}\n`, "utf8");

  const result = await triagePendingQueue(store, home, config);
  assert.deepEqual(result, {
    checked: 3,
    routed: 2,
    kept: 1,
    capture_remembered: 0,
    capture_held: 0,
    capture_shadowed: 1,
  });
  const queue = fs.readFileSync(queueFile, "utf8").trim().split("\n").map(JSON.parse);
  const routed = queue.find((entry) => entry.pair_id === machinePair);
  const kept = queue.find((entry) => entry.pair_id === humanPair);
  assert.equal(routed.status, "routed");
  assert.equal(routed.route, "machine");
  assert.match(routed.routed_at, /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(routed.claims, { a: machineA.claim, b: machineB.claim });
  assert.equal(kept.status, "pending");
  assert.equal(kept.crux_plain, "앞으로 어떤 방식을 더 중요하게 생각하는지 확인이 필요해요.");
  // 제로터치: human capture는 pending 대신 shadow로 라우팅되고 enrichment는 보존된다
  const shadowedCapture = queue.find((entry) => entry.type === "capture");
  assert.equal(shadowedCapture.status, "routed");
  assert.equal(shadowedCapture.route, "shadow");
  assert.equal(shadowedCapture.crux_plain, "앞으로 이 결정을 계속 따를지 확인이 필요해요.");
  assert.equal(shadowedCapture.recommend, "remember");
  const ledger126 = listUndoLedger(home);
  assert.equal(ledger126.filter((e) => e.action === "shadow").length, 1);
});

test("capture triage remembers confirmed technical facts, holds noise, and keeps human decisions", async (t) => {
  const { home, store } = isolatedStore(t);
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  const captures = [
    {
      pair_id: "cap:remember",
      type: "capture",
      status: "pending",
      claim: "기술 기록 자동 캡처가 활성화됐다",
      scope: "project:capture",
      project: "/tmp/capture-project",
      session_id: "capture-session",
      confidence: 0.92,
      at: new Date(Date.now() - 1000).toISOString(),
    },
    {
      pair_id: "cap:hold",
      type: "capture",
      status: "pending",
      claim: "일회성 디버그 출력이 잠깐 보였다",
      scope: "project:capture",
      project: "/tmp/capture-project",
      confidence: 0.55,
    },
    {
      pair_id: "cap:human",
      type: "capture",
      status: "pending",
      claim: "가격 정책은 창업자가 최종 결정한다",
      scope: "project:capture",
      project: "/tmp/capture-project",
      confidence: 0.84,
    },
  ];
  fs.writeFileSync(
    queueFile,
    `${captures.map(JSON.stringify).join("\n")}\n`,
    "utf8",
  );

  const result = await triagePendingQueue(store, home, config);
  assert.deepEqual(result, {
    checked: 3,
    routed: 3,
    kept: 0,
    capture_remembered: 1,
    capture_held: 1,
    capture_shadowed: 1,
  });

  const queue = fs.readFileSync(queueFile, "utf8").trim().split("\n").map(JSON.parse);
  const remembered = queue.find((entry) => entry.pair_id === "cap:remember");
  assert.equal(remembered.status, "answered");
  assert.equal(remembered.action, "remember");
  assert.equal(remembered.answered_by, "triage");
  const fact = store.getFact(remembered.fact_id);
  assert.equal(fact.claim, "기술 기록 자동 캡처가 활성화됐다");
  assert.equal(fact.provenance.source, "capture");
  assert.equal(fact.provenance.session_id, "capture-session");

  const held = queue.find((entry) => entry.pair_id === "cap:hold");
  assert.equal(held.status, "routed");
  assert.equal(held.route, "hold");
  assert.match(held.routed_at, /^\d{4}-\d{2}-\d{2}T/u);

  const human = queue.find((entry) => entry.pair_id === "cap:human");
  assert.equal(human.status, "routed");
  assert.equal(human.route, "shadow");
  assert.equal(human.crux_plain, "앞으로 이 결정을 계속 따를지 확인이 필요해요.");
  assert.equal(
    human.context_plain,
    "7월 16일에 capture-project 작업을 정리하다가 나온 내용이에요.",
  );
  assert.equal(human.recommend, "remember");
  assert.equal(
    human.recommend_reason_plain,
    "이미 정한 방향이라 기억해 두면 다음 작업에서 다시 확인할 수 있어요.",
  );

  const report = writeReport(store, home, {
    applied: 0,
    queued: 0,
    skipped: 0,
    ...result,
  });
  const reportText = fs.readFileSync(report.file, "utf8");
  assert.match(reportText, /AI가 대신 기억함 1건/u);
  assert.match(reportText, /보류 1건/u);
});

test("triagePendingQueue never downgrades an existing human capture to remember", async (t) => {
  const { home, store } = isolatedStore(t);
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  const capture = {
    pair_id: "cap:existing-human",
    type: "capture",
    status: "pending",
    claim: "기술 기록이지만 이미 사람이 확인하기로 한 결정이다",
    scope: "project:capture",
    project: "/tmp/capture-project",
    confidence: 0.9,
    crux_plain: "이 결정은 직접 확인이 필요해요.",
  };
  fs.writeFileSync(queueFile, `${JSON.stringify(capture)}\n`, "utf8");

  const result = await triagePendingQueue(store, home, config);

  assert.deepEqual(result, {
    checked: 1,
    routed: 1,
    kept: 0,
    capture_remembered: 0,
    capture_held: 0,
    capture_shadowed: 1,
  });
  const shadowedHuman = JSON.parse(fs.readFileSync(queueFile, "utf8").trim());
  assert.equal(shadowedHuman.status, "routed");
  assert.equal(shadowedHuman.route, "shadow");
  // 핵심 불변식: human 판정 카드는 어떤 경로로도 자동 remember 되지 않는다 (shadow는 fact를 만들지 않음)
  assert.equal(store.query().length, 0);
  assert.equal(listUndoLedger(home)[0].action, "shadow");
});

test("triagePendingQueue never routes an existing human pair to machine", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "기술 기록 배포 방식은 자동이다", "project:pair-human");
  const b = add(store, "기술 기록 배포 방식은 수동이다", "project:pair-human");
  const pair = {
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    crux: "배포 방식이 갈려요.",
    reason: "서로 다른 방식을 말한다.",
    claims: { a: a.claim, b: b.claim },
    status: "pending",
    crux_plain: "어떤 방식을 따를지 직접 확인이 필요해요.",
  };
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  fs.writeFileSync(queueFile, `${JSON.stringify(pair)}\n`, "utf8");

  const result = await triagePendingQueue(store, home, config);

  assert.deepEqual(result, {
    checked: 1,
    routed: 0,
    kept: 1,
    capture_remembered: 0,
    capture_held: 0,
    capture_shadowed: 0,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(queueFile, "utf8").trim()), pair);
});

test("capture triage drops a context with a dash but keeps the human card", async (t) => {
  const { home, store } = isolatedStore(t);
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  const capture = {
    pair_id: "cap:invalid-context",
    type: "capture",
    status: "pending",
    claim: "줄표 배경 가격 정책은 창업자가 최종 결정한다",
    scope: "project:capture",
    project: "/tmp/capture-project",
    confidence: 0.84,
    at: "2026-07-16T09:30:00.000Z",
  };
  fs.writeFileSync(queueFile, `${JSON.stringify(capture)}\n`, "utf8");

  const result = await triagePendingQueue(store, home, config);
  assert.deepEqual(result, {
    checked: 1,
    routed: 1,
    kept: 0,
    capture_remembered: 0,
    capture_held: 0,
    capture_shadowed: 1,
  });
  const queued = JSON.parse(fs.readFileSync(queueFile, "utf8").trim());
  assert.equal(queued.status, "routed");
  assert.equal(queued.route, "shadow");
  assert.equal(queued.crux_plain, "앞으로 이 결정을 계속 따를지 확인이 필요해요.");
  assert.equal(Object.hasOwn(queued, "context_plain"), false);
  assert.equal(queued.recommend, "remember");
  assert.equal(
    queued.recommend_reason_plain,
    "이미 정한 방향이라 기억해 두면 다음 작업에서 다시 확인할 수 있어요.",
  );
});

test("capture triage failure leaves the card pending", async (t) => {
  const { home, store } = isolatedStore(t);
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(queueFile), { recursive: true });
  const capture = {
    pair_id: "cap:fail-open",
    type: "capture",
    status: "pending",
    claim: "파싱 실패 자동 캡처",
    scope: "project:capture",
    project: "/tmp/capture-project",
    confidence: 0.7,
  };
  fs.writeFileSync(queueFile, `${JSON.stringify(capture)}\n`, "utf8");

  const result = await triagePendingQueue(store, home, config);
  assert.deepEqual(result, {
    checked: 1,
    routed: 0,
    kept: 1,
    capture_remembered: 0,
    capture_held: 0,
    capture_shadowed: 0,
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(queueFile, "utf8").trim()), capture);
});

test("triage command rejects unapproved executables", async (t) => {
  const { home, store } = isolatedStore(t);
  void store;
  await assert.rejects(
    triageCards([], { triage_cmd: ["bash", "x"] }, home),
    /허용되지 않은 triage_cmd/u,
  );
});
