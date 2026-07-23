import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { recall } from "../src/core/recall.js";
import { STATUS, claimHash, newId } from "../src/core/schema.js";
import {
  compareFactSnapshots,
  importExportFile,
  writeExportFile,
} from "../src/core/portability.js";

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

test("rebuild skips telemetry events (shadow.resolve_cycle) instead of throwing", (t) => {
  const state = isolatedStore(t);
  for (let index = 0; index < 3; index += 1) state.store.addFact(fact(index));
  // 텔레메트리 활동 이벤트는 fact 이벤트와 append-only 정본을 공유한다. rebuild가 이를
  // 만나도 죽지 않아야 한다(사고 2026-07-19: shadow.resolve_cycle 스킵 누락으로 소화 데몬 3일 정지).
  state.store.appendEvent({
    ev: "shadow.resolve_cycle",
    checked: 20,
    corroborated: 2,
    contradicted: 0,
    no_signal: 18,
    at: new Date().toISOString(),
  });
  const before = state.store.query({ scope: "project:alpha", status: STATUS.ACTIVE });

  state.store.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.join(state.home, `index.sqlite${suffix}`), { force: true });
  }
  const rebuilt = new Store(state.home);
  state.replace(rebuilt);
  assert.doesNotThrow(() => rebuilt.rebuild());
  assert.deepEqual(rebuilt.query({ scope: "project:alpha", status: STATUS.ACTIVE }), before);
});

test("rebuild still throws on a corrupt fact-mutation event with no id", (t) => {
  const state = isolatedStore(t);
  assert.throws(() => state.store.applyEvent({ ev: "fact.superseded" }), /E_INVALID_INPUT/);
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

// TASK-BATCH-FIX (F-1): a duplicated supplied ev_id must apply exactly once LIVE, identically to
// first-wins replay — so live state == post-rebuild state == export/import state. Before the fix
// the second conflicting transition applied live and then diverged from rebuild/export.
test("a duplicated ev_id applies once live and matches rebuild and export/import", (t) => {
  const state = isolatedStore(t);
  const home = state.home;
  const a = fact(0, { id: "fa_f1_a", claim: "f1 dedup subject alpha claim" });
  const b = fact(1, { id: "fa_f1_b", claim: "f1 dedup subject beta claim" });
  state.store.addFact(a);
  state.store.addFact(b);

  // First occurrence of ev_dupF1 invalidates A (this one must win).
  state.store.appendEvent({
    ev: "fact.invalidated",
    id: "fa_f1_a",
    patch: { t_invalid: "2025-06-01" },
    ev_id: "ev_dupF1",
  });
  // Second, conflicting occurrence with the SAME ev_id — must be skipped live.
  state.store.appendEvent({
    ev: "fact.superseded",
    id: "fa_f1_a",
    patch: { superseded_by: "fa_f1_b", t_invalid: "2025-07-01" },
    ev_id: "ev_dupF1",
  });

  // Live: first-wins — A is invalidated, the supersede never landed.
  const live = state.store.getFact("fa_f1_a");
  assert.equal(live.status, STATUS.INVALIDATED);
  assert.equal(live.superseded_by, null);

  // Post-rebuild replays the log first-wins → identical state.
  state.store.rebuild();
  const rebuilt = state.store.getFact("fa_f1_a");
  assert.equal(rebuilt.status, STATUS.INVALIDATED);
  assert.equal(rebuilt.superseded_by, null);

  // Export/import (import replays via rebuild) → identical fact rows to live.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-f1-export-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const exportFile = path.join(outDir, "portable.json");
  writeExportFile(home, exportFile);
  const importedHome = path.join(outDir, "imported");
  importExportFile(exportFile, importedHome);
  const imported = new Store(importedHome);
  t.after(() => imported.close());
  assert.equal(imported.getFact("fa_f1_a").status, STATUS.INVALIDATED);
  assert.equal(imported.getFact("fa_f1_a").superseded_by, null);
  assert.deepEqual(
    compareFactSnapshots(state.store.query(), imported.query()),
    { equal: true, missing: [], unexpected: [], changed: [] },
  );
});
