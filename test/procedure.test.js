import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { STATUS } from "../src/core/schema.js";
import { matchProcedures, normalizeTrigger } from "../src/core/procedure.js";
import { createServer } from "../src/mcp/server.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-proc-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

function candidate(fact_id, trigger, extra = {}) {
  return { fact_id, claim: `claim ${fact_id}`, scope: "procedure", trigger, ...extra };
}

// TASK-067 matcher: 대상(target)
test("matcher includes a procedure whose intent keyword matches", () => {
  const out = matchProcedures(
    [candidate("fa_1", { intent: ["deploy"], priority: 50 })],
    { current_intent: "I want to deploy the app", scope: "project:x" },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].fact_id, "fa_1");
  assert.equal(out[0].matched_via, "intent");
});

test("matcher drops a procedure whose keywords do not appear", () => {
  const out = matchProcedures(
    [candidate("fa_1", { includes: ["release"], priority: 50 })],
    { current_intent: "fixing a small typo", scope: "project:x" },
  );
  assert.equal(out.length, 0);
});

// TASK-067 matcher: 제외(exclude)
test("matcher excludes when an exclude keyword is present even if included", () => {
  const out = matchProcedures(
    [candidate("fa_1", { intent: ["deploy"], excludes: ["staging"], priority: 50 })],
    { current_intent: "deploy to staging", scope: "project:x" },
  );
  assert.equal(out.length, 0);
});

// TASK-067 matcher: scope
test("matcher filters by trigger scope when a query scope is given", () => {
  const cands = [
    candidate("fa_1", { intent: ["deploy"], scope: "project:a", priority: 50 }),
    candidate("fa_2", { intent: ["deploy"], scope: "project:b", priority: 50 }),
    candidate("fa_3", { intent: ["deploy"], priority: 50 }), // no scope → any
  ];
  const out = matchProcedures(cands, { current_intent: "deploy now", scope: "project:a" });
  const ids = out.map((p) => p.fact_id).sort();
  assert.deepEqual(ids, ["fa_1", "fa_3"]);
});

// TASK-067 matcher: priority
test("matcher ranks by priority descending", () => {
  const cands = [
    candidate("fa_low", { intent: ["deploy"], priority: 10 }),
    candidate("fa_high", { intent: ["deploy"], priority: 90 }),
    candidate("fa_mid", { intent: ["deploy"], priority: 50 }),
  ];
  const out = matchProcedures(cands, { current_intent: "deploy", scope: "person" });
  assert.deepEqual(out.map((p) => p.fact_id), ["fa_high", "fa_mid", "fa_low"]);
});

// TASK-067 matcher: tool-event
test("matcher gates on tool_event when a tool_event query is present", () => {
  const cands = [
    candidate("fa_evt", { tool_events: ["PreToolUse:Bash"], priority: 50 }),
    candidate("fa_intent", { intent: ["deploy"], priority: 50 }),
  ];
  const out = matchProcedures(cands, {
    current_intent: "deploy",
    scope: "person",
    tool_event: "PreToolUse:Bash",
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].fact_id, "fa_evt");
  assert.equal(out[0].matched_via, "tool_event");
});

test("normalizeTrigger clamps priority to 0..100 and coerces arrays", () => {
  const t1 = normalizeTrigger({ priority: 999, intent: "not-array", excludes: ["a", 3, ""] });
  assert.equal(t1.priority, 100);
  assert.deepEqual(t1.intent, []);
  assert.deepEqual(t1.excludes, ["a"]);
  assert.equal(normalizeTrigger({ priority: -5 }).priority, 0);
});

// TASK-067 store integration
test("store lists triggers only for active procedure-scope facts and survives rebuild", (t) => {
  const { store } = isolatedStore(t);
  const proc = remember(store, { claim: "배포 전 항상 테스트를 돌린다", scope: "procedure" }, config);
  const person = remember(store, { claim: "커피는 아메리카노", scope: "person" }, config);

  store.setProcedureTrigger(proc.id, { intent: ["deploy", "배포"], priority: 80 });
  // person-scope fact에 트리거를 걸어도 목록에는 안 나온다(active procedure만).
  store.setProcedureTrigger(person.id, { intent: ["coffee"], priority: 10 });

  let listed = store.listProcedureTriggers();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].fact_id, proc.id);
  assert.deepEqual(listed[0].trigger.intent, ["deploy", "배포"]);

  // 파생 표는 이벤트 로그에서 rebuild로 복원된다.
  store.rebuild();
  listed = store.listProcedureTriggers();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].fact_id, proc.id);

  // procedure fact가 아카이브되면 목록에서 빠진다.
  store.transition(proc.id, STATUS.ARCHIVED, {}, "daemon");
  assert.equal(store.listProcedureTriggers().length, 0);
});

// TASK-067 MCP tool
test("get_applicable_procedures MCP tool returns matched procedures", async (t) => {
  const { store } = isolatedStore(t);
  const proc = remember(store, { claim: "릴리스 절차: 태그를 먼저 푸시한다", scope: "procedure" }, config);
  store.setProcedureTrigger(proc.id, { intent: ["release", "릴리스"], priority: 70 });

  const server = createServer(store, config);
  const handler = server._registeredTools["get_applicable_procedures"].handler;
  const result = JSON.parse((await handler({ current_intent: "릴리스 준비 중", scope: "person" }, {})).content[0].text);
  assert.equal(result.procedures.length, 1);
  assert.equal(result.procedures[0].fact_id, proc.id);
  assert.equal(typeof result.next_memory_action, "string");
});
