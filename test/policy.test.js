import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { applyJudgments } from "../src/daemon/apply.js";
import { listUndoLedger } from "../src/core/review.js";
import { STATUS } from "../src/core/schema.js";

// Zero-touch policy: contradictions are shadowed in undo ledger, never auto-invalidated (unless opt-in).
// No cards go to human review queue.
test("contradiction defaults to shadow, never auto-invalidates or queues", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "정책 테스트: 포트는 7001이다", scope: "project:p" }, cfg);
  const b = remember(store, { claim: "정책 테스트: 포트는 7002로 변경되었다", scope: "project:p" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    confidence: 0.95,
    newer: "b",
    reason: "포트 변경",
  }]); // config 미전달 = 제품 기본값

  assert.equal(result.applied, 0);
  assert.equal(result.queued, 0);
  assert.equal(result.shadowed, 1);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE); // 무효화 안 됨
  const ledger = listUndoLedger(home);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].action, "shadow");
  store.close();
});

test("machine oracle contradiction is journaled without a review card", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "기술 기록: 빌드는 대기 상태다", scope: "project:oracle" }, cfg);
  const b = remember(store, { claim: "기술 기록: 빌드는 완료 상태다", scope: "project:oracle" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    confidence: 0.88,
    newer: "b",
    reason: "빌드 상태가 다르다",
    oracle: "machine",
  }]);

  assert.deepEqual(result, { applied: 0, queued: 0, shadowed: 0, skipped: 0, machine_oracle: 1, triage_routed: 0 });
  assert.equal(fs.existsSync(path.join(home, "review", "queue.jsonl")), false);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(b.id).status, STATUS.ACTIVE);
  const journal = fs.readFileSync(path.join(home, "daemon", "journal.jsonl"), "utf8")
    .trim().split("\n").map(JSON.parse);
  assert.equal(journal[0].outcome, "skipped_machine_oracle");
});

test("user oracle contradiction is shadowed instead of queued", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "프로젝트 방향은 A다", scope: "project:oracle" }, cfg);
  const b = remember(store, { claim: "프로젝트 방향은 B다", scope: "project:oracle" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    confidence: 0.88,
    newer: "b",
    reason: "프로젝트 방향이 다르다",
    oracle: "user",
  }]);

  assert.equal(result.queued, 0);
  assert.equal(result.shadowed, 1);
  assert.equal(result.machine_oracle, 0);
  const ledger = listUndoLedger(home);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].action, "shadow");
});

test("missing oracle defaults to shadow", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "선호 설정은 A다", scope: "project:oracle" }, cfg);
  const b = remember(store, { claim: "선호 설정은 B다", scope: "project:oracle" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    confidence: 0.88,
    newer: "b",
    reason: "선호 설정이 다르다",
  }]);

  assert.equal(result.queued, 0);
  assert.equal(result.shadowed, 1);
  assert.equal(result.machine_oracle, 0);
  const ledger = listUndoLedger(home);
  assert.equal(ledger.length, 1);
});
