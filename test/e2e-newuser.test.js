import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { startDashboard } from "../src/dashboard/server.js";
import { runDigestOnce } from "../src/onboard/setup.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockJudge = path.join(root, "test", "fixtures", "mock-judge.js");

test("a genuinely isolated new user completes setup, digestion, and review over HTTP", async (t) => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "glymph-newuser-"));
  const home = path.join(userHome, ".glymph");
  const previousAllowance = process.env.GLYMPH_ALLOW_TEST_JUDGE;
  process.env.GLYMPH_ALLOW_TEST_JUDGE = "1";
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") return "glymph: connected\n";
    return "ok\n";
  };
  const started = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner,
    runDigest: (targetHome) => runDigestOnce(targetHome),
  });
  const origin = `http://127.0.0.1:${started.port}`;
  const postSetup = async (step) => {
    const response = await fetch(`${origin}/api/setup/${step}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text);
  };
  t.after(async () => {
    await new Promise((resolve) => started.server.close(resolve));
    if (previousAllowance === undefined) delete process.env.GLYMPH_ALLOW_TEST_JUDGE;
    else process.env.GLYMPH_ALLOW_TEST_JUDGE = previousAllowance;
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  await postSetup("init");
  await postSetup("mcp");
  await postSetup("instructions");
  await postSetup("daemon");
  assert.ok(calls.some((call) => call[0] === "claude" && call[1] === "mcp" && call[2] === "add"));
  assert.ok(calls.some((call) => call[0] === "launchctl" && call[1] === "bootstrap"));

  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: [process.execPath, mockJudge],
  })}\n`, "utf8");
  const seeded = await postSetup("sample");
  assert.equal(seeded.seeded, 4);
  const digest = await postSetup("digest");
  assert.equal(digest.ok, true);

  const cardsResponse = await fetch(`${origin}/api/cards`);
  assert.equal(cardsResponse.status, 200);
  const cards = (await cardsResponse.json()).cards;
  const contradiction = cards.find((card) => card.verdict === "contradiction");
  assert.ok(contradiction);

  const applied = await fetch(`${origin}/api/cards/${encodeURIComponent(contradiction.pair_id)}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ action: "newer_wins" }),
  });
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).ok, true);

  const [aId, bId] = contradiction.pair_id.split(":");
  const newerId = contradiction.newer === "a" ? aId : bId;
  const olderId = newerId === aId ? bId : aId;
  const db = new Database(path.join(home, "index.sqlite"), { readonly: true });
  try {
    assert.equal(db.prepare("SELECT status FROM facts WHERE id = ?").get(newerId).status, "active");
    assert.equal(db.prepare("SELECT status FROM facts WHERE id = ?").get(olderId).status, "invalidated");
  } finally {
    db.close();
  }
});
