import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { remember } from "../src/core/gate.js";
import { Store } from "../src/core/store.js";
import { HTML } from "../src/dashboard/public.js";
import { startDashboard } from "../src/dashboard/server.js";

const config = { default_scope: "person" };

test("continuity claim matching normalizes exact, contained, and unrelated text", () => {
  const functionLine = (name) => HTML.split("\n")
    .find((line) => line.includes(`function ${name}(`));
  const matches = Function(
    `${functionLine("normalizeContinuityClaim")}\n${functionLine("continuityClaimsMatch")}\nreturn continuityClaimsMatch;`,
  )();

  assert.equal(matches("  커밋   메시지는 한국어다. ", "커밋 메시지는 한국어다"), true);
  assert.equal(matches("나는 커밋 메시지를 한국어로 쓴다", "커밋 메시지를 한국어로 쓴다."), true);
  assert.equal(matches("내 기본 브랜치는 main이다", "배포 전에는 테스트한다"), false);
});

test("isolated continuity flow detects MCP remember, dashboard recall, and duplicate remember", async (t) => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-continuity-e2e-"));
  const home = path.join(userHome, ".nautli");
  const previousHome = process.env.NAUTLI_HOME;
  process.env.NAUTLI_HOME = home;

  const dashboard = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner: () => "ok\n",
  });
  const origin = dashboard.url;
  t.after(async () => {
    await new Promise((resolve) => dashboard.server.close(resolve));
    if (previousHome === undefined) delete process.env.NAUTLI_HOME;
    else process.env.NAUTLI_HOME = previousHome;
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  const since = new Date(Date.now() - 1_000).toISOString();
  let store = new Store(home);
  const added = remember(store, {
    claim: "나는 커밋 메시지를 한국어로 쓴다",
    scope: "person",
    source: "mcp",
  }, config);
  store.close();
  assert.equal(added.status, "added");

  let response = await fetch(`${origin}/api/activity?since=${encodeURIComponent(since)}`);
  assert.equal(response.status, 200);
  let activity = await response.json();
  assert.ok(activity.events.some((event) => event.type === "remember"
    && event.source === "mcp"
    && event.fact_id === added.id));

  response = await fetch(`${origin}/api/continuity/recall`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ fact_id: added.id }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fact.id, added.id);

  response = await fetch(`${origin}/api/activity?since=${encodeURIComponent(since)}`);
  assert.equal(response.status, 200);
  activity = await response.json();
  assert.ok(activity.events.some((event) => event.type === "recall"
    && event.hits.includes(added.id)));

  const duplicateSince = new Date(Date.now() - 1_000).toISOString();
  store = new Store(home);
  const duplicate = remember(store, {
    claim: "나는 커밋 메시지를 한국어로 쓴다",
    scope: "person",
    source: "mcp",
  }, config);
  store.close();
  assert.equal(duplicate.status, "duplicate");

  response = await fetch(`${origin}/api/activity?since=${encodeURIComponent(duplicateSince)}`);
  assert.equal(response.status, 200);
  activity = await response.json();
  assert.ok(activity.events.some((event) => event.type === "remember"
    && event.result === "duplicate"
    && event.claim === "나는 커밋 메시지를 한국어로 쓴다"
    && event.source === "mcp"));
});
