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

test("a genuinely isolated new user completes setup, digestion, and zero-touch cleanup over HTTP", async (t) => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-newuser-"));
  const home = path.join(userHome, ".nautli");
  const previousAllowance = process.env.NAUTLI_ALLOW_TEST_JUDGE;
  process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") return "nautli: connected\n";
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
    if (previousAllowance === undefined) delete process.env.NAUTLI_ALLOW_TEST_JUDGE;
    else process.env.NAUTLI_ALLOW_TEST_JUDGE = previousAllowance;
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
    triage_cmd: false,
  })}\n`, "utf8");
  const seeded = await postSetup("sample");
  assert.equal(seeded.seeded, 4);
  const digest = await postSetup("digest");
  assert.equal(digest.ok, true);

  // Zero-touch: no cards pushed to user. Instead check cleanup history.
  const historyResponse = await fetch(`${origin}/api/cleanup-history`);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.ok(history.entries.length > 0, "cleanup history should have entries after digest");
  assert.ok(history.stats.total > 0);

  // Sample facts produce mid-confidence duplicate (0.7) and contradiction (0.95)
  // Both are shadowed in zero-touch mode (no auto-apply for mid-confidence or contradictions)
  const shadows = history.entries.filter((entry) => entry.action === "shadow");
  assert.ok(shadows.length >= 2, "both sample pairs should be shadowed");
  const verdicts = new Set(shadows.map((e) => e.verdict));
  assert.ok(verdicts.has("duplicate"), "duplicate pair should be shadowed");
  assert.ok(verdicts.has("contradiction"), "contradiction pair should be shadowed");
});
