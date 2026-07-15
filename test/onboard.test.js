import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCards } from "../src/core/review.js";
import {
  DAEMON_LABEL,
  digestFreshness,
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
process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";

function isolatedHome(t) {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-onboard-"));
  const home = path.join(userHome, ".nautli");
  const previous = process.env.NAUTLI_HOME;
  process.env.NAUTLI_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.NAUTLI_HOME;
    else process.env.NAUTLI_HOME = previous;
    fs.rmSync(userHome, { recursive: true, force: true });
  });
  return { home, userHome };
}

test("onboarding steps are isolated and shell commands use the injected runner", (t) => {
  const { home, userHome } = isolatedHome(t);
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") return "nautli: connected\n";
    return "ok\n";
  };

  initStore(home);
  assert.ok(fs.existsSync(path.join(home, "index.sqlite")));
  registerMcp(home, runner);

  const preview = installInstructions(home, {
    userHome,
    previewOnly: true,
    locale: "ko",
  });
  assert.match(preview.preview, new RegExp(INSTRUCTIONS_START));
  assert.match(preview.block, /nautli 기억 사용 규칙/u);
  assert.equal(fs.existsSync(preview.file), false);
  installInstructions(home, { userHome, locale: "ko" });
  installInstructions(home, { userHome, locale: "ko" });
  assert.equal((fs.readFileSync(preview.file, "utf8").match(/nautli:instructions/g) ?? []).length, 2);

  installDaemon(home, runner, { userHome, uid: 501 });
  const plist = path.join(userHome, "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
  assert.match(fs.readFileSync(plist, "utf8"), /com\.nautli\.daemon/);
  const mcpAdd = calls.find((call) => call[0] === "claude" && call[1] === "mcp" && call[2] === "add");
  // NA-021: user 스코프 필수 — local이면 설치 폴더 밖 프로젝트에서 MCP가 안 보임
  assert.deepEqual(mcpAdd.slice(3, 5), ["-s", "user"]);
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

test("daemon completion is independent from digestion health", (t) => {
  const { home, userHome } = isolatedHome(t);
  const runner = () => "ok\n";

  installDaemon(home, runner, { userHome, uid: 501 });
  const daemonDir = path.join(home, "daemon");
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, "health.log"), `${JSON.stringify({
    at: new Date().toISOString(),
    exit: 1,
    result: { ok: false, reason: "판정 실패" },
  })}\n`, "utf8");

  const daemon = statusAll(home, { runner, userHome, uid: 501 })
    .required.daemon;
  assert.equal(daemon.plist_exists, true);
  assert.equal(daemon.registered, true);
  assert.equal(daemon.health.healthy, false);
  assert.equal(daemon.complete, true);
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

test("daemon plist enables catch-up and stale labels are booted out first", (t) => {
  const { home, userHome } = isolatedHome(t);
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    // 미로드 상태에서 선제 bootout은 실패한다 — installDaemon은 이를 무시해야 한다.
    if (command === "launchctl" && args[0] === "bootout") throw new Error("Boot-out failed: 5: Input/output error");
    return "ok\n";
  };

  const result = installDaemon(home, runner, { userHome, uid: 501 });
  assert.equal(result.ok, true);
  const plist = fs.readFileSync(result.plist, "utf8");
  assert.match(plist, /RunAtLoad/);
  assert.match(plist, /StartCalendarInterval/);
  const launchctl = calls.filter((call) => call[0] === "launchctl");
  assert.deepEqual(launchctl[0].slice(1), ["bootout", "gui/501/com.nautli.daemon"]);
  assert.equal(launchctl[1][1], "bootstrap");
});

test("bootstrap failure surfaces the stale-label guidance", (t) => {
  const { home, userHome } = isolatedHome(t);
  const runner = (command, args) => {
    if (command === "launchctl" && args[0] === "bootstrap") throw new Error("Bootstrap failed: 5: Input/output error");
    return "ok\n";
  };

  assert.throws(
    () => installDaemon(home, runner, { userHome, uid: 501 }),
    (error) => error.code === "E_LAUNCHCTL_FAILED"
      && /bootout gui\/501\/com\.nautli\.daemon/.test(error.message),
  );
});

test("digestFreshness keys on the last successful digestion", (t) => {
  const { home } = isolatedHome(t);
  const file = path.join(home, "daemon", "health.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const hoursAgo = (n) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

  assert.equal(digestFreshness(home).fresh, false);

  fs.writeFileSync(file, `${JSON.stringify({ at: hoursAgo(25), exit: 0 })}\n`, "utf8");
  assert.equal(digestFreshness(home).fresh, false);

  fs.appendFileSync(file, `${JSON.stringify({ at: hoursAgo(2), exit: 0 })}\n`, "utf8");
  assert.equal(digestFreshness(home).fresh, true);

  // 성공 이후의 실패 기록은 catch-up 판단을 뒤집지 않는다.
  fs.appendFileSync(file, `${JSON.stringify({ at: hoursAgo(1), exit: 1 })}\n`, "utf8");
  assert.equal(digestFreshness(home).fresh, true);

  fs.writeFileSync(file, `${JSON.stringify({ at: hoursAgo(1), exit: 1 })}\n`, "utf8");
  assert.equal(digestFreshness(home).fresh, false);
});

test("runDigestOnce skips when another digestion holds the lock", async (t) => {
  const { home } = isolatedHome(t);
  initStore(home);
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: [process.execPath, mockJudge],
  })}\n`, "utf8");
  const lock = path.join(home, "daemon", "run.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, "12345\n", "utf8");

  const blocked = await runDigestOnce(home);
  assert.equal(blocked.skipped_run, true);

  const stale = new Date(Date.now() - 4 * 60 * 60 * 1000);
  fs.utimesSync(lock, stale, stale);
  const ran = await runDigestOnce(home);
  assert.equal(ran.ok, true);
  assert.equal(ran.skipped_run, undefined);
  assert.equal(fs.existsSync(lock), false);
});
