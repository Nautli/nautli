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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-instr-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return store;
}

function readEvents(store) {
  const eventsDir = path.join(store.home, "events");
  if (!fs.existsSync(eventsDir)) return [];
  const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
  const events = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(eventsDir, file), "utf8").split("\n").filter(Boolean);
    for (const line of lines) events.push(JSON.parse(line));
  }
  return events;
}

test("recall event has tool='recall' by default", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "테스트 사실", scope: "project:test" }, config);
  recall(store, "테스트", { scope: "project:test" });
  const recallEvents = readEvents(store).filter((e) => e.type === "recall" && !e.ev);
  assert.equal(recallEvents.length, 1);
  assert.equal(recallEvents[0].tool, "recall");
});

test("briefing internal recall logs tool='briefing'", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "브리핑 테스트 사실", scope: "person" }, config);
  briefing(store, "브리핑 컨텍스트", undefined, { default_scope: "person" });
  const recallEvents = readEvents(store).filter((e) => e.type === "recall" && !e.ev);
  assert.equal(recallEvents.length, 1);
  assert.equal(recallEvents[0].tool, "briefing");
});

test("briefing passes session_id through to event", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "세션 테스트", scope: "person" }, config);
  briefing(store, "ctx", undefined, { default_scope: "person", session_id: "sess-abc" });
  const recallEvents = readEvents(store).filter((e) => e.type === "recall" && !e.ev);
  assert.equal(recallEvents.length, 1);
  assert.equal(recallEvents[0].session_id, "sess-abc");
});

test("recall event records hit count accurately", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "히트 카운트 사실 하나", scope: "project:hits" }, config);
  remember(store, { claim: "히트 카운트 사실 둘", scope: "project:hits" }, config);
  recall(store, "히트 카운트", { scope: "project:hits" });
  const recallEvents = readEvents(store).filter((e) => e.type === "recall" && !e.ev);
  assert.equal(recallEvents.length, 1);
  assert.equal(recallEvents[0].hits.length, 2);
});

test("empty recall records tool field and zero hits", (t) => {
  const store = isolatedStore(t);
  recall(store, "존재하지 않는 쿼리", { scope: "project:nope" });
  const recallEvents = readEvents(store).filter((e) => e.type === "recall" && !e.ev);
  assert.equal(recallEvents.length, 1);
  assert.equal(recallEvents[0].tool, "recall");
  assert.equal(recallEvents[0].hits.length, 0);
});
