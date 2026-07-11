import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { remember } from "../src/core/gate.js";
import { Store } from "../src/core/store.js";
import { initStore } from "../src/onboard/setup.js";
import { startDashboard } from "../src/dashboard/server.js";

const config = { default_scope: "person" };

async function dashboard(t) {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nightmerge-dashboard-"));
  const home = path.join(userHome, ".nightmerge");
  const runner = (command, args) => {
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") return "nightmerge: connected\n";
    return "ok\n";
  };
  const started = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner,
    runDigest: () => ({ ok: true, started: true }),
  });
  t.after(async () => {
    await new Promise((resolve) => started.server.close(resolve));
    fs.rmSync(userHome, { recursive: true, force: true });
  });
  return { ...started, home, origin: `http://127.0.0.1:${started.port}` };
}

test("dashboard status combines setup, doctor, stats, and pending count", async (t) => {
  const target = await dashboard(t);
  initStore(target.home);
  const response = await fetch(`${target.url}/api/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.setup.required.store.complete, true);
  assert.equal(status.doctor.index_exists, true);
  assert.equal(status.stats.total, 0);
  assert.equal(status.pending, 0);
});

test("dashboard card POST delegates pair-id idempotency to review", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const oldFact = remember(store, {
    claim: "대시보드 검토용 옛 기억",
    scope: "project:dashboard",
    t_valid: "2025-01-01",
  }, config);
  const newFact = remember(store, {
    claim: "대시보드 검토용 새 기억",
    scope: "project:dashboard",
    t_valid: "2025-02-01",
  }, config);
  const pairId = `${oldFact.id}:${newFact.id}`;
  fs.writeFileSync(path.join(target.home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: pairId,
    verdict: "duplicate",
    confidence: 0.8,
    claims: { a: "대시보드 검토용 옛 기억", b: "대시보드 검토용 새 기억" },
    status: "pending",
  })}\n`, "utf8");
  store.close();

  const options = {
    method: "POST",
    headers: { origin: target.origin, "content-type": "application/json" },
    body: JSON.stringify({ action: "merge" }),
  };
  const first = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, options);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).ok, true);
  const second = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: false, reason: "already_handled" });
});

test("dashboard rejects state changes from a non-allowlisted Origin", async (t) => {
  const target = await dashboard(t);
  const response = await fetch(`${target.url}/api/setup/init`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:9999", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "E_ORIGIN_FORBIDDEN");
  assert.equal(fs.existsSync(path.join(target.home, "index.sqlite")), false);
});

test("dashboard translates remember gate rejection into human-readable 400 JSON", async (t) => {
  const target = await dashboard(t);
  const response = await fetch(`${target.url}/api/memory`, {
    method: "POST",
    headers: { origin: target.origin, "content-type": "application/json" },
    body: JSON.stringify({ claim: "첫째; 둘째; 셋째", scope: "person" }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "E_MULTI_FACT",
    message: "한 번에 한 가지 기억만 추가해 주세요.",
  });
});
