import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { createServer } from "../src/mcp/server.js";

const config = { default_scope: "person", judge_cmd: null, triage_cmd: false };

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-recall-schema-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const server = createServer(store, config);
  const handler = (name) => server._registeredTools[name].handler;
  return { store, handler };
}

async function call(handler, input) {
  return JSON.parse((await handler(input, {})).content[0].text);
}

// TASK-068 — new shape strict
test("recall new shape (current_intent + phase + scope) succeeds without deprecation", async (t) => {
  const { store, handler } = setup(t);
  remember(store, { claim: "신규 스키마 사실", scope: "project:s" }, config);
  const result = await call(handler("recall"), {
    current_intent: "신규 스키마 확인",
    phase: "act",
    scope: "project:s",
  });
  assert.equal(result.error, undefined);
  assert.equal(result._deprecation, undefined);
  assert.equal(typeof result.next_memory_action, "string");
});

test("recall new shape without phase is rejected", async (t) => {
  const { handler } = setup(t);
  const result = await call(handler("recall"), { current_intent: "무엇", scope: "person" });
  assert.equal(result.error, "E_INVALID_INPUT");
  assert.match(result.message, /phase/u);
  assert.equal(typeof result.next_memory_action, "string");
});

test("recall new shape without scope is rejected", async (t) => {
  const { handler } = setup(t);
  const result = await call(handler("recall"), { current_intent: "무엇", phase: "plan" });
  assert.equal(result.error, "E_INVALID_INPUT");
  assert.match(result.message, /scope/u);
});

// TASK-068 — legacy shape accepted with _deprecation
test("recall legacy shape {task, scope} still works and carries _deprecation", async (t) => {
  const { store, handler } = setup(t);
  remember(store, { claim: "레거시 스키마 사실", scope: "project:legacy" }, config);
  const result = await call(handler("recall"), { task: "레거시", scope: "project:legacy" });
  assert.equal(result.error, undefined);
  assert.equal(typeof result._deprecation, "string");
  assert.match(result._deprecation, /deprecated/u);
  assert.equal(typeof result.next_memory_action, "string");
});

// TASK-068 — next_memory_action present on every tool response
test("next_memory_action is added to remember, briefing, consolidate, procedures", async (t) => {
  const { store, handler } = setup(t);
  const remembered = await call(handler("remember"), { claim: "액션 래퍼 사실", scope: "person" });
  assert.equal(typeof remembered.next_memory_action, "string");

  const briefed = await call(handler("briefing"), { context: "hi", scope: "person" });
  assert.equal(typeof briefed.next_memory_action, "string");

  const consolidated = await call(handler("consolidate"), {});
  assert.equal(typeof consolidated.next_memory_action, "string");

  const procedures = await call(handler("get_applicable_procedures"), { current_intent: "x", scope: "person" });
  assert.equal(typeof procedures.next_memory_action, "string");

  void store;
});

// TASK-068 — error payloads also carry next_memory_action
test("error payloads also carry next_memory_action", async (t) => {
  const { handler } = setup(t);
  const result = await call(handler("recall"), {});
  assert.equal(result.error, "E_INVALID_INPUT");
  assert.equal(typeof result.next_memory_action, "string");
});
