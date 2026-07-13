import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { remember } from "../src/core/gate.js";
import { recall } from "../src/core/recall.js";
import { Store } from "../src/core/store.js";
import { startDashboard } from "../src/dashboard/server.js";

const config = { default_scope: "person" };

function tempHome(t) {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-activity-"));
  const home = path.join(userHome, ".nautli");
  t.after(() => fs.rmSync(userHome, { recursive: true, force: true }));
  return { home, userHome };
}

test("remember and recall activity survives rebuild without becoming facts", async (t) => {
  const { home, userHome } = tempHome(t);
  const since = new Date(Date.now() - 60_000).toISOString();
  let store = new Store(home);
  const added = remember(store, {
    claim: "활동 로그 왕복 검증 기억",
    scope: "person",
    source: "mcp",
  }, config);
  const factBefore = store.getFact(added.id);
  const recalled = recall(store, "활동 로그 왕복", { source: "cli" });
  assert.deepEqual(recalled.facts.map((fact) => fact.id), [added.id]);
  assert.deepEqual(store.getFact(added.id), factBefore);

  const eventsBefore = store.activity({ since });
  assert.equal(eventsBefore.length, 2);
  assert.equal(eventsBefore[0].type, "remember");
  assert.equal(eventsBefore[0].source, "mcp");
  assert.deepEqual(eventsBefore[1], {
    type: "recall",
    query: "활동 로그 왕복",
    scope: null,
    hits: [added.id],
    source: "cli",
    at: eventsBefore[1].at,
  });

  store.rebuild();
  assert.equal(store.stats().total, 1);
  assert.deepEqual(store.getFact(added.id), factBefore);
  assert.deepEqual(store.activity({ since }), eventsBefore);
  assert.equal(fs.existsSync(path.join(home, ".index-dirty")), false);
  store.close();

  const dashboard = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner: () => "ok\n",
  });
  t.after(() => new Promise((resolve) => dashboard.server.close(resolve)));
  const memory = await fetch(`${dashboard.url}/api/memory?q=${encodeURIComponent("활동 로그 왕복")}`);
  assert.equal(memory.status, 200);
  const response = await fetch(`${dashboard.url}/api/activity?since=${encodeURIComponent(since)}`);
  assert.equal(response.status, 200);
  const activity = await response.json();
  assert.equal(activity.events.length, 3);
  assert.equal(activity.events.at(-1).type, "recall");
  assert.equal(activity.events.at(-1).source, "dashboard");
  assert.deepEqual(activity.events.at(-1).hits, [added.id]);
});

test("activity API rejects an invalid since timestamp", async (t) => {
  const { home, userHome } = tempHome(t);
  const store = new Store(home);
  store.close();
  const dashboard = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner: () => "ok\n",
  });
  t.after(() => new Promise((resolve) => dashboard.server.close(resolve)));
  const response = await fetch(`${dashboard.url}/api/activity?since=not-a-date`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "E_INVALID_INPUT");
});

test("activity with since keeps the newest events when over limit", (t) => {
  const { home } = tempHome(t);
  const store = new Store(home);
  const base = Date.now() - 30_000;
  for (let i = 0; i < 10; i += 1) {
    remember(store, {
      claim: `overflow 검증 기억 ${i}`,
      scope: "project:overflow",
      at: new Date(base + i * 1000).toISOString(),
    }, config);
  }
  const since = new Date(base - 1000).toISOString();
  const events = store.activity({ since, limit: 3 });
  assert.equal(events.length, 3);
  const claims = events.map((event) => event.claim);
  assert.deepEqual(claims, ["overflow 검증 기억 7", "overflow 검증 기억 8", "overflow 검증 기억 9"]);
});

test("dashboard rejects requests with a foreign host header", async (t) => {
  const { home } = tempHome(t);
  const dashboard = await startDashboard(home, { port: 0, open: false });
  t.after(async () => {
    await new Promise((resolve) => dashboard.server.close(resolve));
  });
  const url = new URL(`${dashboard.url}/api/activity?since=${encodeURIComponent(new Date().toISOString())}`);
  const { status, body } = await new Promise((resolve, reject) => {
    const request = http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { host: "evil.example.com" },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: raw }));
    });
    request.on("error", reject);
  });
  assert.equal(status, 403);
  assert.equal(JSON.parse(body).error, "E_HOST_FORBIDDEN");
});
