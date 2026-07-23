import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remember } from "../src/core/gate.js";
import { recall } from "../src/core/recall.js";
import { Store } from "../src/core/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

function runCli(home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

function readEventFiles(home) {
  return fs.readdirSync(path.join(home, "events"))
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => fs.readFileSync(path.join(home, "events", name), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line)));
}

test("purge scrubs the canonical log, index, rebuild, and review queue", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-purge-"));
  let store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const claims = [
    "영구삭제 원문 비밀 claim alpha unique with a deliberately long private suffix",
    "남겨둘 기억 claim beta unique",
    "남겨둘 기억 claim gamma unique",
  ];
  const ids = claims.map((claim) => remember(store, {
    claim,
    scope: "project:purge",
    source: "capture",
  }, { default_scope: "person" }).id);
  const queue = path.join(home, "review", "queue.jsonl");
  fs.writeFileSync(queue, `${JSON.stringify({
    pair_id: `${ids[0]}:${ids[1]}`,
    status: "pending",
    claims: { a: claims[0], b: claims[1] },
  })}\n`, "utf8");

  const eventsBeforePreview = readEventFiles(home);
  const queueBeforePreview = fs.readFileSync(queue, "utf8");
  store.close();
  const preview = runCli(home, ["purge", ids[0]]);
  assert.deepEqual(preview.facts, [{
    id: ids[0],
    claim: [...claims[0]].slice(0, 40).join(""),
  }]);
  store = new Store(home);
  assert.equal(store.query().length, 3);
  assert.deepEqual(readEventFiles(home), eventsBeforePreview);
  assert.equal(fs.readFileSync(queue, "utf8"), queueBeforePreview);

  const result = store.purge([ids[0]], { source: "test" });
  assert.equal(result.purged, 1);
  const repeated = store.purge([ids[0]], { source: "test" });
  assert.equal(repeated.purged, 0);
  assert.equal(fs.existsSync(path.join(home, "purge-journal.json")), false);
  assert.equal(store.getFact(ids[0]), null);
  assert.equal(store.query().some((fact) => fact.id === ids[0]), false);
  // recall은 같은 scope의 남은 기억을 정당하게 반환할 수 있다 — 검증 대상은 purged id의 부재다.
  assert.equal(
    recall(store, "영구삭제", { scope: "project:purge" }).facts.some((fact) => fact.id === ids[0]),
    false,
  );

  const events = readEventFiles(home);
  assert.equal(JSON.stringify(events).includes(claims[0]), false);
  const tombstone = events.find((event) => event.ev === "fact.purged"
    && event.fact_ids.includes(ids[0]));
  assert.ok(tombstone);
  assert.equal(Object.hasOwn(tombstone, "claim"), false);
  assert.equal(Object.hasOwn(tombstone, "fact"), false);
  assert.equal(Object.hasOwn(tombstone, "patch"), false);
  assert.deepEqual(tombstone.fact_ids, [ids[0]]);
  assert.equal(fs.readFileSync(queue, "utf8"), "");
  assert.equal(
    fs.readdirSync(path.join(home, "events"))
      .map((name) => fs.readFileSync(path.join(home, "events", name), "utf8"))
      .join("\n")
      .includes(claims[0]),
    false,
  );

  store.rebuild();
  assert.equal(store.getFact(ids[0]), null);
  assert.equal(store.query().some((fact) => fact.id === ids[0]), false);
  // recall은 같은 scope의 남은 기억을 정당하게 반환할 수 있다 — 검증 대상은 purged id의 부재다.
  assert.equal(
    recall(store, "영구삭제", { scope: "project:purge" }).facts.some((fact) => fact.id === ids[0]),
    false,
  );
  assert.deepEqual(new Set(store.query().map((fact) => fact.id)), new Set(ids.slice(1)));
});

// TASK-BATCH-FIX (F-3): purge must acquire the same rebuild lock so it can't race a rebuild and
// resurrect a purged fact. With the lock held it fails E_STORE_BUSY; released, it works as before.
test("purge acquires the rebuild lock: E_STORE_BUSY while held, works once released", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-purge-lock-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const target = remember(store, {
    claim: "purge lock target claim with a long private suffix here",
    scope: "project:purge-lock",
  }, { default_scope: "person" });
  assert.ok(store.getFact(target.id));

  // A live lock (this process pid) makes acquireRebuildLock treat the owner as alive.
  const lockPath = path.join(home, ".index-rebuild.lock");
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
    { mode: 0o600 },
  );
  assert.throws(() => store.purge([target.id], { source: "test" }), (error) => error.code === "E_STORE_BUSY");
  // Purge was rejected before mutating anything — the fact is still present, lock untouched.
  assert.ok(store.getFact(target.id));
  assert.equal(fs.existsSync(lockPath), true);

  fs.rmSync(lockPath, { force: true });
  const result = store.purge([target.id], { source: "test" });
  assert.equal(result.purged, 1);
  assert.equal(store.getFact(target.id), null);
  // Purge released the lock it acquired (finally), so a later purge can still run.
  assert.equal(fs.existsSync(lockPath), false);
});

test("Store opening resumes a purge journal and removes it after every step", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-purge-recovery-"));
  let store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const removed = remember(store, {
    claim: "저널 복구로 삭제할 민감한 claim tail",
    scope: "project:purge-recovery",
  }, { default_scope: "person" });
  const kept = remember(store, {
    claim: "저널 복구 뒤에도 남을 claim",
    scope: "project:purge-recovery",
  }, { default_scope: "person" });
  const queue = path.join(home, "review", "queue.jsonl");
  fs.writeFileSync(queue, `${JSON.stringify({
    pair_id: `${removed.id}:${kept.id}`,
    status: "pending",
  })}\n`, "utf8");
  store.close();
  const journal = path.join(home, "purge-journal.json");
  fs.writeFileSync(journal, `${JSON.stringify({
    ids: [removed.id],
    at: "2026-07-14T12:00:00.000Z",
  })}\n`, "utf8");

  store = new Store(home);
  assert.equal(store.getFact(removed.id), null);
  assert.ok(store.getFact(kept.id));
  assert.equal(JSON.stringify(readEventFiles(home)).includes(removed.claim), false);
  assert.equal(fs.readFileSync(queue, "utf8"), "");
  assert.equal(fs.existsSync(journal), false);
});

test("rebuild replays add, tombstone, and same-id add in chronological order", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-purge-readd-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const original = remember(store, {
    claim: "시간순 재생 원본 A",
    scope: "project:purge-readd",
  }, { default_scope: "person" });
  const originalFact = store.getFact(original.id);
  store.appendEvent({ ev: "fact.purged", fact_ids: [original.id] });
  store.addFact({
    ...originalFact,
    claim: "시간순 재생 대체 A prime",
    claim_hash: undefined,
  });

  store.rebuild();
  assert.equal(store.getFact(original.id)?.claim, "시간순 재생 대체 A prime");
});
