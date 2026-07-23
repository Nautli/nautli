// TASK-002
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readCurrent, startCheckup } from "../src/onboard/checkup.js";

// TASK-002
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = path.join(root, "test", "fixtures", "checkup-lock-worker.js");

// TASK-002
function tempHome(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// TASK-002
function makeVault(userHome) {
  const vault = path.join(userHome, "vault");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "# note");
  return vault;
}

// TASK-002
function runWorker(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], { cwd: root, env: { ...process.env, ...environment } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `worker exited ${code}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

// TASK-002
test("two simultaneous checkup starts spawn once and retain only the winner artifacts", async (t) => {
  const userHome = tempHome(t, "nautli-checkup-lock-race-");
  const home = path.join(userHome, ".nautli");
  const vault = makeVault(userHome);
  const gate = path.join(userHome, "gate");
  const ready = path.join(userHome, "ready");
  const environment = { CHECKUP_HOME: home, CHECKUP_USER_HOME: userHome, CHECKUP_VAULT: vault, CHECKUP_GATE: gate, CHECKUP_READY: ready };
  const first = runWorker({ ...environment, CHECKUP_TOKEN: "first" });
  const second = runWorker({ ...environment, CHECKUP_TOKEN: "second" });
  while (!fs.existsSync(ready) || fs.readFileSync(ready, "utf8").trim().split("\n").length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  fs.writeFileSync(gate, "go");
  const results = await Promise.all([first, second]);
  const winner = results.find((result) => result.result?.started);
  const loser = results.find((result) => result.error);
  assert.equal(winner.result.started, true);
  assert.equal(loser.error, "E_STORE_BUSY");
  assert.deepEqual(fs.readFileSync(path.join(home, "checkup", "spawns"), "utf8").trim().split("\n"), [winner.token]);
  assert.equal(fs.readFileSync(path.join(home, "checkup", "checkup.log"), "utf8").trim(), winner.token);
  const current = readCurrent(home);
  assert.equal(current.pid, winner.pid);
  assert.equal(fs.readFileSync(path.join(current.run_dir, "winner"), "utf8"), winner.token);
});

// TASK-002
test("a dead start-lock owner is reclaimed", (t) => {
  const userHome = tempHome(t, "nautli-checkup-lock-dead-");
  const home = path.join(userHome, ".nautli");
  const vault = makeVault(userHome);
  const lock = path.join(home, "checkup", ".start-lock");
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 2147483646, started_at: new Date().toISOString() }));
  const started = startCheckup(home, vault, { userHome, spawner: () => ({ pid: process.pid, unref() {}, on() {} }) });
  assert.equal(started.started, true);
  assert.equal(fs.existsSync(lock), false);
});

// TASK-002
test("a live start-lock owner returns E_STORE_BUSY", (t) => {
  const userHome = tempHome(t, "nautli-checkup-lock-live-");
  const home = path.join(userHome, ".nautli");
  const vault = makeVault(userHome);
  const lock = path.join(home, "checkup", ".start-lock");
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  assert.throws(
    () => startCheckup(home, vault, { userHome, spawner: () => ({ pid: process.pid, unref() {}, on() {} }) }),
    (error) => error.code === "E_STORE_BUSY",
  );
  assert.equal(fs.existsSync(lock), true);
});

// TASK-002
test("a synchronous spawn failure publishes no running state and removes the start lock", (t) => {
  const userHome = tempHome(t, "nautli-checkup-lock-spawn-");
  const home = path.join(userHome, ".nautli");
  const vault = makeVault(userHome);
  assert.throws(() => startCheckup(home, vault, {
    userHome,
    spawner: () => { throw new Error("spawn failed"); },
  }), /spawn failed/);
  assert.equal(readCurrent(home), null);
  assert.equal(fs.existsSync(path.join(home, "checkup", ".start-lock")), false);
});

// TASK-002
test("the start lock is removed after a normal start", (t) => {
  const userHome = tempHome(t, "nautli-checkup-lock-normal-");
  const home = path.join(userHome, ".nautli");
  const vault = makeVault(userHome);
  startCheckup(home, vault, { userHome, spawner: () => ({ pid: process.pid, unref() {}, on() {} }) });
  assert.equal(fs.existsSync(path.join(home, "checkup", ".start-lock")), false);
});
