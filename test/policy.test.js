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

// r1 리뷰 반영: T1 auto-merge는 judge의 newer 필드가 승자 방향의 정본이다 (GO 조건 ③).
test("T1 auto-merge follows judgment.newer over t_valid ordering", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  const cfg = { default_scope: "person" };
  // a가 시간상 더 오래됐지만 judge는 a를 승자(newer)로 판정
  const a = remember(store, { claim: "뉴어 테스트: 배포 절차 v1 표현", scope: "project:p", t_valid: "2025-01-01" }, cfg);
  const b = remember(store, { claim: "뉴어 테스트: 배포 절차 v2 표현", scope: "project:p", t_valid: "2025-02-01" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "duplicate",
    confidence: 0.95,
    newer: "a",
    reason: "같은 절차",
  }]);

  assert.equal(result.applied, 1);
  assert.equal(store.getFact(b.id).status, STATUS.SUPERSEDED); // t_valid로는 b가 최신이지만 judge가 a 승
  assert.equal(store.getFact(b.id).superseded_by, a.id);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  store.close();
});

// r1 리뷰 반영: 승자 방향 판별 불가(newer 부재 + t_valid·confidence 동률)면 조용한 누락 대신 shadow.
test("T1 tie without newer falls back to shadow instead of silent skip", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "동률 테스트: 캐시 TTL은 60초", scope: "project:p", t_valid: "2025-01-01" }, cfg);
  const b = remember(store, { claim: "동률 테스트: 캐시 TTL 60초로 설정", scope: "project:p", t_valid: "2025-01-01" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "duplicate",
    confidence: 0.95,
    reason: "같은 값",
  }]);

  assert.equal(result.applied, 0);
  assert.equal(result.shadowed, 1);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(b.id).status, STATUS.ACTIVE);
  store.close();
});

// r1 리뷰 반영: 티어 표에 저신뢰 하한 없음 — confidence 0.5 contradiction도 skipped가 아니라 shadow.
test("low-confidence contradiction is shadowed, not skipped", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "저신뢰 테스트: 리전은 서울이다", scope: "project:p" }, cfg);
  const b = remember(store, { claim: "저신뢰 테스트: 리전은 도쿄다", scope: "project:p" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    confidence: 0.5,
    newer: "b",
    reason: "리전 상이",
  }]);

  assert.equal(result.shadowed, 1);
  const ledger = listUndoLedger(home);
  assert.equal(ledger[0].action, "shadow");
  assert.equal(ledger[0].newer, "b"); // 마이크로 컨펌용 방향 보존
  store.close();
});

// r1 리뷰 반영: 한쪽(b)만 person이어도 T1 발화 금지 → shadow.
test("T1 is blocked when either side is person scope", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "스코프 테스트: 아침형 인간이다", scope: "project:p" }, cfg);
  const b = remember(store, { claim: "스코프 테스트: 아침형 인간에 가깝다", scope: "person" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "duplicate",
    confidence: 0.95,
    newer: "b",
    reason: "같은 성향",
  }]);

  assert.equal(result.applied, 0);
  assert.equal(result.shadowed, 1);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  store.close();
});

// r2 리뷰 반영: newer 오염값("c")은 부재 취급 금지 — 시간 폴백 병합 대신 shadow.
test("invalid explicit newer value demotes T1 to shadow", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-policy-"));
  const store = new Store(home);
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "오염값 테스트: 큐 이름은 jobs다", scope: "project:p", t_valid: "2025-01-01" }, cfg);
  const b = remember(store, { claim: "오염값 테스트: 큐 이름 jobs 사용", scope: "project:p", t_valid: "2025-02-01" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "duplicate",
    confidence: 0.95,
    newer: "c",
    reason: "같은 값",
  }]);

  assert.equal(result.applied, 0);
  assert.equal(result.shadowed, 1);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(b.id).status, STATUS.ACTIVE);
  store.close();
});
