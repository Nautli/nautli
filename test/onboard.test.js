import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCards } from "../src/core/review.js";
import {
  DAEMON_LABEL,
  initStore,
  installDaemon,
  installInstructions,
  registerMcp,
  removeInstructions,
  removeSampleFacts,
  runDigestOnce,
  seedSampleFacts,
  statusAll,
  uninstallDaemon,
} from "../src/onboard/setup.js";
import { INSTRUCTIONS_START } from "../src/onboard/instructions.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockJudge = path.join(root, "test", "fixtures", "mock-judge.js");
process.env.GLYMPH_ALLOW_TEST_JUDGE = "1";

function isolatedHome(t) {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "glymph-onboard-"));
  const home = path.join(userHome, ".glymph");
  const previous = process.env.GLYMPH_HOME;
  process.env.GLYMPH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.GLYMPH_HOME;
    else process.env.GLYMPH_HOME = previous;
    fs.rmSync(userHome, { recursive: true, force: true });
  });
  return { home, userHome };
}

test("onboarding steps are isolated and shell commands use the injected runner", (t) => {
  const { home, userHome } = isolatedHome(t);
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") return "glymph: connected\n";
    return "ok\n";
  };

  initStore(home);
  assert.ok(fs.existsSync(path.join(home, "index.sqlite")));
  registerMcp(home, runner);

  const preview = installInstructions(home, { userHome, previewOnly: true });
  assert.match(preview.preview, new RegExp(INSTRUCTIONS_START));
  assert.equal(fs.existsSync(preview.file), false);
  installInstructions(home, { userHome });
  installInstructions(home, { userHome });
  assert.equal((fs.readFileSync(preview.file, "utf8").match(/glymph:instructions/g) ?? []).length, 2);

  installDaemon(home, runner, { userHome, uid: 501 });
  const plist = path.join(userHome, "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
  assert.match(fs.readFileSync(plist, "utf8"), /com\.glymph\.daemon/);
  assert.ok(calls.some((call) => call[0] === "claude" && call[1] === "mcp" && call[2] === "add"));
  assert.ok(calls.some((call) => call[0] === "launchctl" && call[1] === "bootstrap"));

  const status = statusAll(home, { runner, userHome });
  assert.equal(status.required.store.complete, true);
  assert.equal(status.required.mcp.complete, true);
  assert.equal(status.required.instructions.complete, true);
  assert.equal(status.required.daemon.plist_exists, true);

  assert.equal(removeInstructions(home, { userHome }).removed, true);
  assert.equal(uninstallDaemon(home, runner, { userHome, uid: 501 }).removed, true);
  assert.ok(calls.some((call) => call[0] === "launchctl" && call[1] === "bootout"));
});

test("sample facts create one duplicate and one contradiction review card", async (t) => {
  const { home } = isolatedHome(t);
  initStore(home);
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: [process.execPath, mockJudge],
  })}\n`, "utf8");

  const seeded = seedSampleFacts(home);
  assert.equal(seeded.seeded, 4);
  await runDigestOnce(home);
  const cards = listCards(home);
  assert.equal(cards.length, 2);
  assert.deepEqual(new Set(cards.map((card) => card.verdict)), new Set(["duplicate", "contradiction"]));
  assert.equal(removeSampleFacts(home).removed, 4);
  assert.equal(listCards(home).length, 0);
});
