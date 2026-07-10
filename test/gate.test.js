import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { ERR, STATUS } from "../src/core/schema.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "onebrain-gate-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return store;
}

test("281 character claims are rejected", (t) => {
  const store = isolatedStore(t);
  assert.deepEqual(remember(store, { claim: "a".repeat(281) }, config), {
    status: "rejected",
    reason: ERR.E_CLAIM_TOO_LONG,
  });
});

test("newline bullet claims are rejected as multiple facts", (t) => {
  const store = isolatedStore(t);
  assert.deepEqual(remember(store, { claim: "first\n- second" }, config), {
    status: "rejected",
    reason: ERR.E_MULTI_FACT,
  });
});

test("the second normalized duplicate returns the original id", (t) => {
  const store = isolatedStore(t);
  const first = remember(store, { claim: "배포는 금요일입니다." }, config);
  const second = remember(store, { claim: "배포는   금요일입니다!" }, config);
  assert.equal(first.status, "added");
  assert.deepEqual(second, {
    id: first.id,
    status: "duplicate",
    reason: ERR.W_DUPLICATE,
  });
});

test("unknown scopes are rejected", (t) => {
  const store = isolatedStore(t);
  assert.deepEqual(remember(store, { claim: "기억", scope: "foo" }, config), {
    status: "rejected",
    reason: ERR.E_UNKNOWN_SCOPE,
  });
});

test("a missing supersedes target is rejected", (t) => {
  const store = isolatedStore(t);
  assert.deepEqual(remember(store, { claim: "새 기억", supersedes: "fa_missing" }, config), {
    status: "rejected",
    reason: ERR.E_NOT_FOUND,
  });
});

test("supersedes adds the new fact and transitions the old fact", (t) => {
  const store = isolatedStore(t);
  const oldFact = remember(store, {
    claim: "포트는 3000",
    scope: "project:alpha",
    t_valid: "2025-01-01",
  }, config);
  const newFact = remember(store, {
    claim: "포트는 4000",
    scope: "project:alpha",
    supersedes: oldFact.id,
    t_valid: "2025-02-01",
  }, config);

  assert.equal(newFact.status, "added");
  assert.equal(store.getFact(oldFact.id).status, STATUS.SUPERSEDED);
  assert.equal(store.getFact(oldFact.id).superseded_by, newFact.id);
  assert.equal(store.getFact(oldFact.id).t_invalid, "2025-02-01");
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
});
