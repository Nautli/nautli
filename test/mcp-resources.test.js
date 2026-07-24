import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { createServer } from "../src/mcp/server.js";
import { renderViews } from "../src/daemon/render.js";

const config = { default_scope: "person", judge_cmd: null };

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-mcp-res-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const server = createServer(store, config);
  return { home, store, server };
}

// TASK-014
test("resources register three kinds: reports/latest, stats, views template", (t) => {
  const { server } = setup(t);
  assert.ok(server._registeredResources["nautli://reports/latest"], "reports resource");
  assert.ok(server._registeredResources["nautli://stats"], "stats resource");
  assert.ok(server._registeredResourceTemplates["views"], "views template");
});

test("stats resource returns parseable JSON of store stats", async (t) => {
  const { store, server } = setup(t);
  remember(store, { claim: "통계 리소스 사실", scope: "project:res" }, config);
  const res = server._registeredResources["nautli://stats"];
  const result = await res.readCallback(new URL("nautli://stats"));
  const parsed = JSON.parse(result.contents[0].text);
  assert.equal(typeof parsed.total, "number");
  assert.equal(parsed.total, 1);
  assert.equal(result.contents[0].mimeType, "application/json");
});

test("reports/latest returns latest report markdown, placeholder when none", async (t) => {
  const { home, server } = setup(t);
  const res = server._registeredResources["nautli://reports/latest"];
  const empty = await res.readCallback(new URL("nautli://reports/latest"));
  assert.match(empty.contents[0].text, /리포트가 없습니다|nautli/u);

  fs.mkdirSync(path.join(home, "reports"), { recursive: true });
  fs.writeFileSync(path.join(home, "reports", "2025-01-01.md"), "# old\n");
  fs.writeFileSync(path.join(home, "reports", "2025-06-01.md"), "# newest report\n");
  const latest = await res.readCallback(new URL("nautli://reports/latest"));
  assert.match(latest.contents[0].text, /newest report/u);
});

test("views template lists active scope URIs and reads a scope view", async (t) => {
  const { home, store, server } = setup(t);
  remember(store, { claim: "뷰 리소스 사실 하나", scope: "project:viewscope" }, config);
  renderViews(store, home);

  const template = server._registeredResourceTemplates["views"];
  const listed = await template.resourceTemplate.listCallback();
  const uris = listed.resources.map((r) => r.uri);
  assert.ok(uris.some((u) => u.startsWith("nautli://views/")), "has a view uri");
  const slug = uris.find((u) => u.startsWith("nautli://views/")).replace("nautli://views/", "");

  const read = await template.readCallback(
    new URL(`nautli://views/${slug}`),
    { scope: slug },
  );
  assert.match(read.contents[0].text, /뷰 리소스 사실 하나/u);
});

test("views template read throws E_NOT_FOUND for unknown scope", async (t) => {
  const { server } = setup(t);
  const template = server._registeredResourceTemplates["views"];
  await assert.rejects(
    () => template.readCallback(new URL("nautli://views/does-not-exist"), { scope: "does-not-exist" }),
    (error) => error.code === "E_NOT_FOUND",
  );
});

// TASK-014
test("remember-well prompt registered and produces guidance messages", async (t) => {
  const { server } = setup(t);
  const prompt = server._registeredPrompts["remember-well"];
  assert.ok(prompt, "prompt registered");
  const result = await prompt.callback({
    claim: "API 포트는 4000",
    scope: "project:myapp",
    source_context: "배포 회의",
  });
  assert.equal(result.messages[0].role, "user");
  assert.match(result.messages[0].content.text, /API 포트는 4000/u);
  assert.match(result.messages[0].content.text, /project:myapp/u);
  assert.match(result.messages[0].content.text, /배포 회의/u);
});
