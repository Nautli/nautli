import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { createServer } from "../src/mcp/server.js";

const config = {
  default_scope: "person",
  judge_cmd: null,
  triage_cmd: false,
};

function isolatedHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-consolidate-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function setup(t) {
  const home = isolatedHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  const server = createServer(store, config);
  const handler = server._registeredTools["consolidate"].handler;
  return { home, store, handler };
}

function add(store, claim, scope, t_valid = "2025-01-01") {
  return remember(store, { claim, scope, t_valid, confidence: 0.8 }, config);
}

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

test("consolidate dry_run returns candidate pairs", async (t) => {
  const { store, handler } = setup(t);
  add(store, "서비스 포트는 3000", "project:test", "2025-01-01");
  add(store, "서비스 포트는 4000", "project:test", "2025-02-01");

  const result = parseResult(await handler({}, {}));

  assert.equal(result.dry_run, true);
  assert.equal(result.total_pairs, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].scope, "project:test");
  assert.ok(result.candidates[0].pair_id);
  assert.ok(result.candidates[0].claim_a);
  assert.ok(result.candidates[0].claim_b);
  assert.ok(typeof result.candidates[0].similarity === "number");
});

test("consolidate dry_run respects scope filter", async (t) => {
  const { store, handler } = setup(t);
  add(store, "서비스 포트는 3000", "project:alpha", "2025-01-01");
  add(store, "서비스 포트는 4000", "project:alpha", "2025-02-01");
  add(store, "배포 환경은 prod", "project:beta", "2025-01-01");
  add(store, "배포 환경은 staging", "project:beta", "2025-02-01");

  const alphaResult = parseResult(await handler({ scope: "project:alpha" }, {}));
  assert.equal(alphaResult.total_pairs, 1);
  assert.equal(alphaResult.candidates[0].scope, "project:alpha");

  const betaResult = parseResult(await handler({ scope: "project:beta" }, {}));
  assert.equal(betaResult.total_pairs, 1);
  assert.equal(betaResult.candidates[0].scope, "project:beta");
});

test("consolidate apply without scope returns E_INVALID_INPUT", async (t) => {
  const { handler } = setup(t);

  const result = parseResult(await handler({ apply: true }, {}));

  assert.equal(result.error, "E_INVALID_INPUT");
  assert.ok(result.message.includes("scope"));
});

test("consolidate returns E_STORE_BUSY when lock is held", async (t) => {
  const { home, handler } = setup(t);
  const lockFile = path.join(home, "daemon", "run.lock");
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "99999\n", { flag: "wx" });

  const result = parseResult(await handler({}, {}));

  assert.equal(result.error, "E_STORE_BUSY");
  fs.rmSync(lockFile, { force: true });
});

test("consolidate dry_run writes journal entry", async (t) => {
  const { home, store, handler } = setup(t);
  add(store, "메모 하나", "person", "2025-01-01");
  add(store, "메모 둘", "person", "2025-02-01");

  await handler({}, {});

  const journalFile = path.join(home, "daemon", "journal.jsonl");
  assert.ok(fs.existsSync(journalFile));
  const lines = fs.readFileSync(journalFile, "utf8").trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  assert.equal(entry.kind, "consolidate_mcp");
  assert.equal(entry.mode, "dry_run");
});

test("consolidate dry_run does not call pipeline (no stage entries in journal)", async (t) => {
  const { home, store, handler } = setup(t);
  add(store, "서비스 포트는 3000", "project:test", "2025-01-01");
  add(store, "서비스 포트는 4000", "project:test", "2025-02-01");

  await handler({}, {});

  const journalFile = path.join(home, "daemon", "journal.jsonl");
  const lines = fs.readFileSync(journalFile, "utf8").trim().split("\n");
  const stageEntries = lines
    .map((l) => JSON.parse(l))
    .filter((e) => e.kind === "stage");
  assert.equal(stageEntries.length, 0, "dry_run should not produce pipeline stage entries");
});

test("consolidate max_pairs caps candidates", async (t) => {
  const { store, handler } = setup(t);
  // Create many similar facts to generate multiple pairs
  for (let i = 0; i < 10; i++) {
    add(store, `서비스 포트는 ${3000 + i}`, "project:many", `2025-0${(i % 9) + 1}-01`);
  }

  const result = parseResult(await handler({ max_pairs: 3 }, {}));

  assert.equal(result.dry_run, true);
  assert.ok(result.candidates.length <= 3);
});
