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
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "glymph-dashboard-"));
  const home = path.join(userHome, ".glymph");
  const runner = (command, args) => {
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") return "glymph: connected\n";
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
  assert.equal((await (await fetch(`${target.url}/api/status`)).json()).pending, 1);
  const first = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, options);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).ok, true);
  const second = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: false, reason: "already_handled" });
  assert.equal((await (await fetch(`${target.url}/api/status`)).json()).pending, 0);
  const page = await (await fetch(target.url)).text();
  assert.match(page, /id="pending-badge"/);
  assert.match(page, /setChrome\(\)/);
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

test("dashboard restores an elapsed deferred card on the next cards request", async (t) => {
  const target = await dashboard(t);
  initStore(target.home);
  const queue = path.join(target.home, "review", "queue.jsonl");
  fs.writeFileSync(queue, `${JSON.stringify({
    pair_id: "fa_deferreda:fa_deferredb",
    verdict: "duplicate",
    status: "deferred",
    deferred_until: "2000-01-01",
  })}\n`, "utf8");
  const response = await fetch(`${target.url}/api/cards`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cards.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(queue, "utf8").trim()).status, "pending");
});

test("dashboard returns a human rejection and preserves an other card", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const a = remember(store, { claim: "기타 정정 중복 원문", scope: "project:dashboard-other" }, config);
  const b = remember(store, { claim: "기타 정정 비교 문장", scope: "project:dashboard-other" }, config);
  const pairId = `${a.id}:${b.id}`;
  fs.writeFileSync(path.join(target.home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: pairId,
    verdict: "contradiction",
    status: "pending",
  })}\n`, "utf8");
  store.close();
  const response = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, {
    method: "POST",
    headers: { origin: target.origin, "content-type": "application/json" },
    body: JSON.stringify({ action: "other", extraText: "기타 정정 중복 원문" }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "W_DUPLICATE",
    message: "이미 같은 기억이 저장되어 있어요.",
  });
  assert.equal((await (await fetch(`${target.url}/api/status`)).json()).pending, 1);
});

test("instructions preview separates location from the pure copy block and exposes fallback UX", async (t) => {
  const target = await dashboard(t);
  const preview = await (await fetch(`${target.url}/api/instructions/preview`)).json();
  assert.match(preview.preview, /추가될 위치:/);
  assert.match(preview.preview, /추가될 블록:/);
  assert.match(preview.block, /^<!-- glymph:instructions -->/);
  assert.doesNotMatch(preview.block, /추가될 위치:/);
  const page = await (await fetch(target.url)).text();
  assert.match(page, /id="manual-copy"/);
  assert.match(page, /클립보드 복사에 실패했어요/);
  assert.match(page, /attempt<120/);
  assert.match(page, /소화 중… 최대 2분/);
  assert.match(page, /finally\{if\(button\.isConnected\)/);
});
