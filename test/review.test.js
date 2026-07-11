import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { remember } from "../src/core/gate.js";
import { applyCard, listCards } from "../src/core/review.js";
import { STATUS } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";

const config = { default_scope: "person" };

function fixture(t, verdict = "duplicate") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nightmerge-review-"));
  const previous = process.env.NIGHTMERGE_HOME;
  process.env.NIGHTMERGE_HOME = home;
  const store = new Store(home);
  const oldFact = remember(store, {
    claim: verdict === "duplicate" ? "검토할 같은 메모의 옛 표현" : "서비스 포트는 3000이다",
    scope: "project:review",
    t_valid: "2025-01-01",
  }, config);
  const newFact = remember(store, {
    claim: verdict === "duplicate" ? "검토할 같은 메모의 새 표현" : "서비스 포트는 4000이다",
    scope: "project:review",
    t_valid: "2025-02-01",
  }, config);
  const pairId = `${oldFact.id}:${newFact.id}`;
  fs.writeFileSync(path.join(home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: pairId,
    verdict,
    confidence: 0.8,
    claims: {
      a: store.getFact(oldFact.id).claim,
      b: store.getFact(newFact.id).claim,
    },
    status: "pending",
  })}\n`, "utf8");
  t.after(() => {
    store.close();
    if (previous === undefined) delete process.env.NIGHTMERGE_HOME;
    else process.env.NIGHTMERGE_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store, oldFact, newFact, pairId };
}

test("merge supersedes the older fact and pair handling is idempotent", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t);
  assert.equal(listCards(home).length, 1);
  assert.equal(applyCard(store, home, pairId, "merge").ok, true);
  assert.equal(store.getFact(oldFact.id).status, STATUS.SUPERSEDED);
  assert.equal(store.getFact(oldFact.id).superseded_by, newFact.id);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
  assert.deepEqual(applyCard(store, home, pairId, "merge"), { ok: false, reason: "already_handled" });
  assert.equal(listCards(home).length, 0);
  assert.equal(fs.readdirSync(path.join(home, "review")).some((file) => file.includes(".tmp-")), false);
});

test("contradiction actions invalidate only the losing fact", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t, "contradiction");
  applyCard(store, home, pairId, "older_wins");
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.INVALIDATED);
});

test("other answer stores a scoped correction and answers the card", (t) => {
  const { home, store, pairId } = fixture(t, "contradiction");
  const result = applyCard(store, home, pairId, "other", "서비스 포트는 환경별로 다르다");
  const correction = store.getFact(result.remembered.id);
  assert.equal(correction.scope, "project:review");
  assert.equal(correction.confidence, 0.9);
  assert.equal(correction.provenance.source, "review-card");
  assert.equal(listCards(home).length, 0);
});

test("keep, defer, and both-valid only update queue status", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t);
  applyCard(store, home, pairId, "keep_separate");
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
  assert.equal(listCards(home).length, 0);
});
