import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall, briefing } from "../src/core/recall.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-recall-err-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return store;
}

function recallEvents(store) {
  const dir = path.join(store.home, "events");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n").filter(Boolean)) {
      const ev = JSON.parse(line);
      if (ev.type === "recall" && !ev.ev) out.push(ev);
    }
  }
  return out;
}

// TASK-073
test("budget below 200 records exactly one error event with code and rethrows", (t) => {
  const store = isolatedStore(t);
  assert.throws(() => recall(store, "무엇이든", { scope: "person", budget_tokens: 100 }),
    (e) => e.code === "E_BUDGET_TOO_SMALL");
  const events = recallEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "error");
  assert.equal(events[0].error_code, "E_BUDGET_TOO_SMALL");
});

// TASK-073
test("hit outcome is stamped when facts are returned", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "히트 계측 사실", scope: "project:hit" }, config);
  recall(store, "히트 계측", { scope: "project:hit" });
  const events = recallEvents(store).filter((e) => e.outcome !== undefined);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "hit");
  assert.ok(events[0].hits.length >= 1);
});

// TASK-073
test("empty outcome is stamped when nothing matches", (t) => {
  const store = isolatedStore(t);
  recall(store, "존재하지않는쿼리xyz", { scope: "project:none" });
  const events = recallEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "empty");
  assert.equal(events[0].hits.length, 0);
});

// TASK-073
test("a forced store error records exactly one error event before rethrowing", (t) => {
  const store = isolatedStore(t);
  store.searchFts = () => {
    const error = new Error("boom");
    error.code = "E_STORE_BUSY";
    throw error;
  };
  assert.throws(() => recall(store, "무엇", { scope: "person" }), /boom/u);
  const events = recallEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "error");
  assert.equal(events[0].error_code, "E_STORE_BUSY");
});

// TASK-073
test("briefing exception path also records one error event tagged briefing", (t) => {
  const store = isolatedStore(t);
  store.searchFts = () => { throw new Error("briefing boom"); };
  assert.throws(() => briefing(store, "ctx", "person", { default_scope: "person" }), /briefing boom/u);
  const events = recallEvents(store);
  assert.equal(events.length, 1);
  assert.equal(events[0].tool, "briefing");
  assert.equal(events[0].outcome, "error");
  // 코드 없는 일반 에러는 기본 error_code로 채워진다.
  assert.equal(events[0].error_code, "E_INVALID_INPUT");
});
