// TASK-003: index/FTS apply failure must be visible (no false 201/success).
// Proves the degraded-response contract across all three consumers (Store.remember
// return, CLI stdout JSON, dashboard HTTP) plus reopen recovery, using a deterministic
// FTS corruption (replace the fts5 virtual table with a schema-incompatible plain table,
// so the fact.added INSERT into facts_fts throws — after the event line is durably logged).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Store, readEventLog } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall } from "../src/core/recall.js";
import { startDashboard } from "../src/dashboard/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const config = { default_scope: "person" };

function freshHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-degraded-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// TASK-003: break FTS so any facts_fts(id, claim, subject) insert throws, without a dirty
// marker present (so the next Store open does NOT rebuild it away before the failure fires).
function corruptFts(indexPath) {
  const db = new Database(indexPath);
  db.exec("DROP TABLE IF EXISTS facts_fts; CREATE TABLE facts_fts (id TEXT);");
  db.close();
}

function markerPath(home) {
  return path.join(home, ".index-dirty");
}

function factAddedCount(home) {
  return readEventLog(home).filter((e) => e.ev === "fact.added").length;
}

// TASK-003: Store.remember return exposes the degraded warning; exactly one event line,
// dirty marker present, no duplicate event, index write did not land.
test("Store.remember returns a degraded warning when the index write fails", (t) => {
  const home = freshHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  store.db.exec("DROP TABLE facts_fts; CREATE TABLE facts_fts (id TEXT);");

  const result = remember(store, {
    claim: "the deployment service port is 3000 in the degraded index test",
    scope: "person",
    source: "core",
  }, config);

  assert.equal(result.status, "added");
  assert.equal(result.degraded, true);
  assert.equal(result.warning, "W_INDEX_DEGRADED");
  assert.equal(typeof result.ev_id, "string");
  assert.ok(result.ev_id.startsWith("ev_"));

  // Exactly one durable event line — the degraded path must not retry/duplicate.
  assert.equal(factAddedCount(home), 1);

  // The index write did not land (proves the failure was real, not swallowed).
  assert.equal(store.getFact(result.id), null);

  // Dirty marker written with the original failure message and the same ev_id.
  const marker = JSON.parse(fs.readFileSync(markerPath(home), "utf8"));
  assert.ok(marker.reason.startsWith("index apply failed:"), marker.reason);
  assert.equal(marker.ev_id, result.ev_id);
  assert.equal(typeof marker.at, "string");
});

// TASK-003: reopening the store recovers the index (fact findable via recall) and removes the marker.
test("reopening the store recovers the index and clears the marker", (t) => {
  const home = freshHome(t);
  const store = new Store(home);
  store.db.exec("DROP TABLE facts_fts; CREATE TABLE facts_fts (id TEXT);");
  const result = remember(store, {
    claim: "the deployment service port is 3000 in the degraded index test",
    scope: "person",
    source: "core",
  }, config);
  assert.equal(result.degraded, true);
  store.close();

  // Reopen: constructor sees the dirty marker → rebuild replays the event log.
  const reopened = new Store(home);
  t.after(() => reopened.close());
  assert.equal(fs.existsSync(markerPath(home)), false);

  const fact = reopened.getFact(result.id);
  assert.ok(fact, "fact should be indexed after recovery");
  assert.match(fact.claim, /deployment service port is 3000/);

  const found = recall(reopened, "deployment service port", { scope: "person", log: false });
  assert.ok(found.facts.some((f) => f.id === result.id), "recovered fact must be findable via recall");
});

// TASK-003: CLI stdout JSON exposes the exact warning and exits 0 (not converted to a rejection).
test("CLI remember prints the degraded warning to stdout without failing", (t) => {
  const home = freshHome(t);
  const init = spawnSync(process.execPath, [cli, "init"], {
    cwd: root, encoding: "utf8", env: { ...process.env, NAUTLI_HOME: home },
  });
  assert.equal(init.status, 0, init.stderr || init.stdout);

  corruptFts(path.join(home, "index.sqlite"));

  const run = spawnSync(process.execPath, [
    cli, "remember", "the deployment service port is 3000 in the degraded index test", "--scope", "person",
  ], { cwd: root, encoding: "utf8", env: { ...process.env, NAUTLI_HOME: home } });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.trim());
  assert.equal(result.status, "added");
  assert.equal(result.degraded, true);
  assert.equal(result.warning, "W_INDEX_DEGRADED");
  assert.equal(typeof result.ev_id, "string");

  assert.equal(factAddedCount(home), 1);
  assert.equal(fs.existsSync(markerPath(home)), true);
});

// TASK-003: dashboard maps a degraded creation to 202 (healthy stays 201) and returns the JSON verbatim.
test("dashboard returns 202 with the degraded warning on an index failure", async (t) => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-degraded-dash-"));
  const home = path.join(userHome, ".nautli");
  new Store(home).close(); // materialize the index schema
  corruptFts(path.join(home, "index.sqlite"));

  const started = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner: (command, args) =>
      (command === "claude" && args[0] === "mcp" ? "nautli: connected\n" : "ok\n"),
    runDigest: () => ({ ok: true, started: true }),
  });
  const origin = `http://127.0.0.1:${started.port}`;
  t.after(async () => {
    await new Promise((resolve) => started.server.close(resolve));
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  const response = await fetch(`${origin}/api/memory`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      claim: "the deployment service port is 3000 in the degraded index test",
      scope: "person",
    }),
  });

  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "added");
  assert.equal(body.degraded, true);
  assert.equal(body.warning, "W_INDEX_DEGRADED");
  assert.equal(typeof body.ev_id, "string");

  assert.equal(factAddedCount(home), 1);
  assert.equal(fs.existsSync(markerPath(home)), true);
});
