import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { STATUS } from "../src/core/schema.js";
import { recordAutoApply, listUndoLedger } from "../src/core/review.js";
import { resolveShadows, findShadowCandidates } from "../src/daemon/shadow-resolve.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockShadowResolve = path.join(root, "test", "fixtures", "mock-shadow-resolve.js");
process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";

const config = {
  default_scope: "project:test",
  shadow_resolve_cmd: [process.execPath, mockShadowResolve],
};

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-shadow-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

function add(store, claim, scope, t_valid, confidence = 0.8) {
  const result = remember(store, { claim, scope, t_valid, confidence }, config);
  // remember() returns {id, status} — attach claim for convenience in tests
  return { ...result, claim };
}

test("findShadowCandidates filters correctly", (t) => {
  const { home } = isolatedStore(t);

  // shadow, not undone, not confirmed — should be candidate
  recordAutoApply(home, {
    pair_id: "fa_a:fa_b",
    action: "shadow",
    verdict: "duplicate",
    confidence: 0.7,
    scope: "project:test",
    fact_ids: ["fa_a", "fa_b"],
    type: "pair",
  });

  // person scope — should be excluded
  recordAutoApply(home, {
    pair_id: "fa_c:fa_d",
    action: "shadow",
    verdict: "duplicate",
    confidence: 0.7,
    scope: "person",
    fact_ids: ["fa_c", "fa_d"],
    type: "pair",
  });

  // already confirmed — should be excluded
  const confirmed = recordAutoApply(home, {
    pair_id: "fa_e:fa_f",
    action: "shadow",
    verdict: "duplicate",
    confidence: 0.7,
    scope: "project:test",
    fact_ids: ["fa_e", "fa_f"],
    type: "pair",
  });
  // Manually mark as confirmed
  const ledgerFile = path.join(home, "review", "undo-ledger.jsonl");
  const entries = fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const idx = entries.findIndex((e) => e.undo_id === confirmed.undo_id);
  entries[idx].confirmed_at = new Date().toISOString();
  fs.writeFileSync(ledgerFile, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

  const candidates = findShadowCandidates(home);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].scope, "project:test");
});

test("resolveShadows corroborates when new evidence supports verdict", async (t) => {
  const { home, store } = isolatedStore(t);

  // Create two facts that form a shadow duplicate pair
  const oldFact = add(store, "서비스 배포 포트는 3000", "project:deploy", "2025-01-01");
  const newFact = add(store, "서비스 배포 포트는 3000번", "project:deploy", "2025-02-01");

  // Record as shadow with applied_at in the past so new facts are "after" it
  const pastDate = "2025-01-15T00:00:00.000Z";
  const shadow = recordAutoApply(home, {
    pair_id: `${oldFact.id}:${newFact.id}`,
    action: "shadow",
    verdict: "duplicate",
    confidence: 0.7,
    scope: "project:deploy",
    fact_ids: [oldFact.id, newFact.id],
    newer: "b",
    claim_a: oldFact.claim,
    claim_b: newFact.claim,
    type: "pair",
  });
  // Backdate the shadow's applied_at
  const ledgerFile = path.join(home, "review", "undo-ledger.jsonl");
  const entries = fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  entries[entries.length - 1].applied_at = pastDate;
  fs.writeFileSync(ledgerFile, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

  // Add corroborating evidence AFTER the shadow was created
  // The mock checks for "확인" in evidence claims
  add(store, "배포 포트 3000 확인 완료", "project:deploy", "2025-03-01");

  const stats = await resolveShadows(store, home, config);

  assert.equal(stats.corroborated, 1);
  assert.equal(stats.contradicted, 0);

  // The old fact should be superseded
  assert.equal(store.getFact(oldFact.id).status, STATUS.SUPERSEDED);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);

  // Undo ledger entry should be updated
  const ledger = listUndoLedger(home);
  const resolved = ledger.find((e) => e.undo_id === shadow.undo_id);
  assert.equal(resolved.action, "merge");
  assert.equal(resolved.shadow_decision, "corroborate");
  assert.equal(resolved.shadow_resolved_by, "corroborate_daemon");
});

test("resolveShadows contradicts when evidence refutes verdict", async (t) => {
  const { home, store } = isolatedStore(t);

  const factA = add(store, "API 엔드포인트는 /v1/users", "project:api", "2025-01-01");
  const factB = add(store, "API 엔드포인트는 /v1/users (변경)", "project:api", "2025-02-01");

  recordAutoApply(home, {
    pair_id: `${factA.id}:${factB.id}`,
    action: "shadow",
    verdict: "duplicate",
    confidence: 0.7,
    scope: "project:api",
    fact_ids: [factA.id, factB.id],
    newer: "b",
    claim_a: factA.claim,
    claim_b: factB.claim,
    type: "pair",
  });

  // Backdate shadow applied_at
  const ledgerFile = path.join(home, "review", "undo-ledger.jsonl");
  const entries = fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  entries[entries.length - 1].applied_at = "2025-01-15T00:00:00.000Z";
  fs.writeFileSync(ledgerFile, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

  // Add contradicting evidence — mock checks for "반박"
  add(store, "v1/users 엔드포인트 반박 증거: 둘은 별개 API", "project:api", "2025-03-01");

  const stats = await resolveShadows(store, home, config);

  assert.equal(stats.contradicted, 1);
  assert.equal(stats.corroborated, 0);

  // Both facts should remain active (contradiction of a "duplicate" means they're separate)
  assert.equal(store.getFact(factA.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(factB.id).status, STATUS.ACTIVE);

  // Ledger entry should be dismissed
  const ledger = listUndoLedger(home);
  const dismissed = ledger.find((e) => e.pair_id === `${factA.id}:${factB.id}`);
  assert.equal(dismissed.action, "dismissed");
  assert.equal(dismissed.shadow_decision, "contradict");
});

test("resolveShadows skips person scope permanently", async (t) => {
  const { home, store } = isolatedStore(t);

  const factA = add(store, "사용자 이름은 홍길동", "person", "2025-01-01");
  const factB = add(store, "사용자 이름은 홍길동입니다", "person", "2025-02-01");

  recordAutoApply(home, {
    pair_id: `${factA.id}:${factB.id}`,
    action: "shadow",
    verdict: "duplicate",
    confidence: 0.7,
    scope: "person",
    fact_ids: [factA.id, factB.id],
    newer: "b",
    claim_a: factA.claim,
    claim_b: factB.claim,
    type: "pair",
  });

  // Even with corroborating evidence, person scope is never auto-committed
  add(store, "홍길동 확인", "person", "2025-03-01");

  const stats = await resolveShadows(store, home, config);
  assert.equal(stats.checked, 0);
  assert.equal(stats.corroborated, 0);

  // Both facts still active
  assert.equal(store.getFact(factA.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(factB.id).status, STATUS.ACTIVE);
});

test("resolveShadows returns no_signal when no evidence exists", async (t) => {
  const { home, store } = isolatedStore(t);

  const factA = add(store, "유니크한내용ABC 첫번째", "project:unique", "2025-01-01");
  const factB = add(store, "유니크한내용ABC 두번째", "project:unique", "2025-02-01");

  recordAutoApply(home, {
    pair_id: `${factA.id}:${factB.id}`,
    action: "shadow",
    verdict: "duplicate",
    confidence: 0.7,
    scope: "project:unique",
    fact_ids: [factA.id, factB.id],
    newer: "b",
    claim_a: factA.claim,
    claim_b: factB.claim,
    type: "pair",
  });

  // No new facts added — evidence will be empty → no_signal without LLM call
  const stats = await resolveShadows(store, home, config);
  assert.equal(stats.no_signal, 1);
  assert.equal(stats.corroborated, 0);
  assert.equal(stats.contradicted, 0);
});

test("resolveShadows handles capture type shadow", async (t) => {
  const { home, store } = isolatedStore(t);

  recordAutoApply(home, {
    pair_id: "capture_001",
    action: "shadow",
    verdict: null,
    confidence: 0.6,
    scope: "project:cap",
    fact_ids: [],
    claim: "프로젝트 X는 3월에 출시",
    type: "capture",
  });

  // Backdate shadow applied_at
  const ledgerFile = path.join(home, "review", "undo-ledger.jsonl");
  const entries = fs.readFileSync(ledgerFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  entries[entries.length - 1].applied_at = "2025-01-15T00:00:00.000Z";
  fs.writeFileSync(ledgerFile, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

  // Add corroborating evidence
  add(store, "프로젝트 X 3월 출시 확인됨", "project:cap", "2025-03-01");

  const stats = await resolveShadows(store, home, config);
  assert.equal(stats.corroborated, 1);

  // The claim should now be remembered as a fact
  const ledger = listUndoLedger(home);
  const resolved = ledger.find((e) => e.pair_id === "capture_001");
  assert.equal(resolved.action, "remember");
  assert.equal(resolved.shadow_decision, "corroborate");
});
