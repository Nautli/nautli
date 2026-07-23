// TASK-001: rebuild 크로스프로세스 락 — 동시 rebuild 상호배제, 스테일 락 회수,
// 살아있는 소유자 보존, throw 시 해제, 마커 원자성, rebuild 중 append의 새 마커 생존.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store, readEventLog } from "../src/core/store.js";
import { STATUS, claimHash, newId } from "../src/core/schema.js";

const WORKER = fileURLToPath(new URL("./fixtures/rebuild-worker.js", import.meta.url));
const lockPath = (home) => path.join(home, ".index-rebuild.lock");
const markerPath = (home) => path.join(home, ".index-dirty");

// TASK-001
function freshHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-rebuild-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// TASK-001
function fact(number, overrides = {}) {
  const claim = overrides.claim ?? `락 사실 ${number}`;
  return {
    id: overrides.id ?? newId(),
    type: "semantic",
    scope: "project:lock",
    subject: "lock",
    claim,
    confidence: 0.8,
    provenance: {},
    t_valid: `2025-01-${String(number + 1).padStart(2, "0")}`,
    t_invalid: null,
    t_expired: null,
    superseded_by: null,
    status: STATUS.ACTIVE,
    claim_hash: claimHash(claim),
  };
}

// TASK-001
function seed(home, count) {
  const store = new Store(home);
  for (let index = 0; index < count; index += 1) store.addFact(fact(index));
  store.close();
}

// TASK-001: 자식 워커를 띄우고 {child, done: Promise<파싱된 결과 JSON>}을 돌려준다.
function spawnWorker(home, role, controlDir) {
  const child = spawn(process.execPath, [WORKER, home, role, controlDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      const line = out.trim().split("\n").filter(Boolean).pop();
      if (!line) {
        reject(new Error(`worker ${role} produced no output (code ${code}) stderr=${err}`));
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`worker ${role} bad output: ${line} stderr=${err}`));
      }
    });
  });
  return { child, done };
}

// TASK-001
async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timeout waiting for ${file}`);
}

// TASK-001: 동기적으로 종료를 기다린 자식의 pid는 이제 확실히 죽어 있다(process.kill(pid,0)→ESRCH).
function deadPid() {
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  return child.pid;
}

// TASK-001: 두 동시 rebuild → 정확히 하나만 진입, 패자는 E_STORE_BUSY.
test("two concurrent rebuilds: exactly one enters, the loser gets E_STORE_BUSY", async (t) => {
  const home = freshHome(t);
  seed(home, 3);
  const controlDir = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-ctrl-"));
  t.after(() => fs.rmSync(controlDir, { recursive: true, force: true }));

  const holder = spawnWorker(home, "holder", controlDir);
  await waitForFile(path.join(controlDir, "entered"), 5000);

  const contender = await spawnWorker(home, "contender", controlDir).done;
  assert.equal(contender.busy, true, `contender: ${JSON.stringify(contender)}`);
  assert.equal(contender.error, "E_STORE_BUSY");

  fs.writeFileSync(path.join(controlDir, "proceed"), "1");
  const holderResult = await holder.done;
  assert.equal(holderResult.entered, true, `holder: ${JSON.stringify(holderResult)}`);

  assert.equal(fs.existsSync(lockPath(home)), false);
});

// TASK-001: 죽은 소유자의 스테일 락은 회수된다.
test("a stale lock from a demonstrably dead owner is reclaimed", (t) => {
  const home = freshHome(t);
  seed(home, 2);
  fs.writeFileSync(
    lockPath(home),
    JSON.stringify({ pid: deadPid(), started_at: new Date().toISOString() }),
    { mode: 0o600 },
  );
  const store = new Store(home);
  t.after(() => store.close());

  assert.doesNotThrow(() => store.rebuild());
  assert.equal(store.stats().total, 2);
  assert.equal(fs.existsSync(lockPath(home)), false);
});

// TASK-001: 살아있는 소유자의 락은 보존되고 rebuild는 E_STORE_BUSY를 던진다.
test("a live owner's lock is preserved and rebuild throws E_STORE_BUSY", (t) => {
  const home = freshHome(t);
  seed(home, 1);
  const content = JSON.stringify({ pid: process.pid, started_at: "2026-01-01T00:00:00.000Z" });
  fs.writeFileSync(lockPath(home), content, { mode: 0o600 });
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(lockPath(home), { force: true });
  });

  assert.throws(() => store.rebuild(), (error) => error.code === "E_STORE_BUSY");
  assert.equal(fs.existsSync(lockPath(home)), true);
  assert.equal(fs.readFileSync(lockPath(home), "utf8"), content);
});

// TASK-001: rebuild 안에서 throw가 나도 락은 finally에서 해제된다.
test("the lock is released when rebuild throws during replay", (t) => {
  const home = freshHome(t);
  seed(home, 2);
  const store = new Store(home);
  t.after(() => store.close());

  store.applyEvent = () => {
    throw new Error("boom-during-replay");
  };
  assert.throws(() => store.rebuild(), /boom-during-replay/);
  assert.equal(fs.existsSync(lockPath(home)), false);
});

// TASK-001: 마커 쓰기는 원자적 — 동시 리더가 부분 JSON을 절대 관측하지 않는다.
test("dirty marker writes are atomic (a concurrent reader never sees partial JSON)", async (t) => {
  const home = freshHome(t);
  const { done } = spawnWorker(home, "marker-spammer", "");
  await waitForFile(markerPath(home), 3000);

  for (let i = 0; i < 3000; i += 1) {
    let raw;
    try {
      raw = fs.readFileSync(markerPath(home), "utf8");
    } catch {
      continue;
    }
    const parsed = JSON.parse(raw); // 부분 JSON이면 여기서 throw → 실패.
    assert.equal(typeof parsed.at, "string");
    assert.ok("ev_id" in parsed);
    assert.equal(typeof parsed.reason, "string");
  }

  const result = await done;
  assert.equal(result.wrote, 400);
});

// TASK-001: rebuild 중 도착한 append는 이벤트를 로그에 남기고, 인덱스 변이는 건너뛰며,
// 더 새로운 마커를 남긴다(ev_id 보존).
test("an append during a rebuild logs the event, skips index mutation, and writes a newer marker", (t) => {
  const home = freshHome(t);
  seed(home, 1);
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(lockPath(home), { force: true });
  });
  // 다른 프로세스가 rebuild 중인 상황을 살아있는 락(이 프로세스 pid)으로 재현.
  fs.writeFileSync(
    lockPath(home),
    JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
    { mode: 0o600 },
  );

  const f = fact(99, { id: "fa_lock_append" });
  assert.equal(store.getFact(f.id), null);
  const event = store.appendEvent({ ev: "fact.added", type: "remember", source: "core", fact: f });

  assert.equal(store.getFact(f.id), null); // 인덱스 변이 건너뜀.
  assert.ok(
    readEventLog(home).some((entry) => entry.ev === "fact.added" && entry.fact?.id === f.id),
    "event should be logged to the canonical log",
  );

  const marker = JSON.parse(fs.readFileSync(markerPath(home), "utf8"));
  assert.equal(marker.reason, "append-during-rebuild");
  assert.equal(marker.ev_id, event.ev_id);
  assert.equal(typeof marker.at, "string");
});

// TASK-001: 리플레이 후 마커가 그대로면 삭제된다.
test("rebuild deletes the dirty marker when it is unchanged after replay", (t) => {
  const home = freshHome(t);
  seed(home, 2);
  const store = new Store(home);
  t.after(() => store.close());
  fs.writeFileSync(
    markerPath(home),
    JSON.stringify({ at: new Date().toISOString(), ev_id: "ev_unchanged", reason: "apply-failed" }),
  );

  store.rebuild();
  assert.equal(fs.existsSync(markerPath(home)), false);
  assert.equal(store.stats().total, 2);
});

// TASK-001: 리플레이 중 더 새로운 마커가 쓰이면 그 마커는 살아남는다(다음 rebuild가 이어받음).
test("a newer marker written during a rebuild survives (is not deleted)", (t) => {
  const home = freshHome(t);
  seed(home, 2);
  const store = new Store(home);
  t.after(() => store.close());

  const m1 = JSON.stringify({ at: "2026-01-01T00:00:00.000Z", ev_id: "ev_old", reason: "apply-failed" });
  fs.writeFileSync(markerPath(home), m1);
  const m2 = JSON.stringify({ at: "2026-01-02T00:00:00.000Z", ev_id: "ev_new", reason: "append-during-rebuild" });

  const original = store.applyEvent.bind(store);
  let first = true;
  store.applyEvent = (evt) => {
    if (first) {
      first = false;
      fs.writeFileSync(markerPath(home), m2); // 동시 append가 더 새로운 마커를 남긴 상황.
    }
    return original(evt);
  };

  store.rebuild();
  assert.equal(fs.existsSync(markerPath(home)), true);
  assert.equal(fs.readFileSync(markerPath(home), "utf8"), m2);
});
