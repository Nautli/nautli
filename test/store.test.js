import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { recall } from "../src/core/recall.js";
import { STATUS, claimHash, newId } from "../src/core/schema.js";

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-store-"));
  let store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return {
    home,
    get store() {
      return store;
    },
    replace(next) {
      store = next;
    },
  };
}

function fact(number, overrides = {}) {
  const claim = overrides.claim ?? `저장소 사실 ${number}`;
  return {
    id: overrides.id ?? newId(),
    type: overrides.type ?? "semantic",
    scope: overrides.scope ?? "project:alpha",
    subject: overrides.subject ?? "store",
    claim,
    confidence: overrides.confidence ?? 0.8,
    provenance: overrides.provenance ?? {},
    t_valid: overrides.t_valid ?? `2025-01-${String(number + 1).padStart(2, "0")}`,
    t_invalid: overrides.t_invalid ?? null,
    t_expired: overrides.t_expired ?? null,
    superseded_by: overrides.superseded_by ?? null,
    status: overrides.status ?? STATUS.ACTIVE,
    claim_hash: overrides.claim_hash ?? claimHash(claim),
  };
}

test("query returns all 20 added facts", (t) => {
  const state = isolatedStore(t);
  for (let index = 0; index < 20; index += 1) state.store.addFact(fact(index));
  assert.equal(state.store.query({ scope: "project:alpha", status: STATUS.ACTIVE }).length, 20);
  assert.equal(state.store.stats().total, 20);
});

test("transition updates status without removing the fact", (t) => {
  const state = isolatedStore(t);
  const original = fact(0);
  state.store.addFact(original);
  state.store.transition(original.id, STATUS.ARCHIVED, { t_expired: "2025-03-01" }, "daemon");
  const archived = state.store.getFact(original.id);
  assert.equal(archived.status, STATUS.ARCHIVED);
  assert.equal(archived.t_expired, "2025-03-01");
  assert.equal(state.store.stats().total, 1);
  assert.deepEqual(state.store.searchFts("저장소"), []);
});

test("deleting the index and rebuilding preserves query and recall results", (t) => {
  const state = isolatedStore(t);
  for (let index = 0; index < 20; index += 1) state.store.addFact(fact(index));
  const beforeQuery = state.store.query({ scope: "project:alpha", status: STATUS.ACTIVE });
  // Pin as_of to eliminate time-dependent freshness drift between calls
  const asOf = new Date().toISOString();
  const beforeRecall = recall(state.store, "저장소", { scope: "project:alpha", budget_tokens: 2000, as_of: asOf });

  state.store.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.join(state.home, `index.sqlite${suffix}`), { force: true });
  }
  const rebuilt = new Store(state.home);
  state.replace(rebuilt);
  rebuilt.rebuild();

  assert.deepEqual(rebuilt.query({ scope: "project:alpha", status: STATUS.ACTIVE }), beforeQuery);
  assert.deepEqual(recall(rebuilt, "저장소", {
    scope: "project:alpha",
    budget_tokens: 2000,
    as_of: asOf,
  }), beforeRecall);
});

test("applying the same event twice is idempotent", (t) => {
  const state = isolatedStore(t);
  const added = fact(0);
  const event = { ev: "fact.added", at: "2025-01-01T00:00:00.000Z", fact: added };
  state.store.applyEvent(event);
  state.store.applyEvent(event);
  assert.equal(state.store.query({}).length, 1);
  assert.equal(state.store.searchFts("저장소").length, 1);

  const archived = {
    ev: "fact.archived",
    at: "2025-02-01T00:00:00.000Z",
    id: added.id,
    patch: { t_expired: "2025-02-01" },
  };
  state.store.applyEvent(archived);
  const once = state.store.getFact(added.id);
  state.store.applyEvent(archived);
  assert.deepEqual(state.store.getFact(added.id), once);
  assert.equal(state.store.stats().total, 1);
});
