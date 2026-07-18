import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCards } from "../src/core/review.js";
import {
  DAEMON_LABEL,
  DASHBOARD_LABEL,
  MENUBAR_LABEL,
  digestFreshness,
  initStore,
  installApp,
  installDaemon,
  installInstructions,
  notifyDigestResult,
  recordDigestSkip,
  registerMcp,
  removeInstructions,
  removeSampleFacts,
  runDigestOnce,
  seedSampleFacts,
  statusAll,
  uninstallApp,
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

test("notifyDigestResult posts a macOS notification via argv (no injection)", () => {
  const calls = [];
  const runner = (command, args) => { calls.push([command, args]); return ""; };
  const ok = notifyDigestResult(
    { ok: true, applied: 3, shadowed: 2 },
    { runner, locale: "ko", config: {} },
  );
  assert.equal(ok.notified, true);
  const [command, args] = calls[0];
  assert.equal(command, "osascript");
  const body = args[args.length - 2];
  // 순찰 공식: 잡은 건수 + 지켜보는 건수. 답변 CTA·리뷰 카드 문구는 금지.
  assert.ok(body.includes("3") && body.includes("2"));
  assert.ok(body.includes("잡았어요") && body.includes("지켜보는 중"));
  assert.ok(!body.includes("리뷰 카드") && !body.includes("답해"));
  // 본문은 argv로만 전달 — -e 스크립트 문자열에 보간되지 않는다
  assert.ok(!args.filter((a, i) => args[i - 1] === "-e").some((s) => s.includes(body)));

  const clear = notifyDigestResult({ ok: true, applied: 0, shadowed: 0 }, { runner, locale: "ko", config: {} });
  assert.equal(clear.notified, true);
  assert.ok(calls[1][1][calls[1][1].length - 2].includes("지켰어요"));

  assert.equal(notifyDigestResult({ ok: true, skipped_run: true }, { runner }).notified, false);
  assert.equal(notifyDigestResult({ ok: true }, { runner, config: { notifications: false } }).notified, false);
});

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

test("installInstructions refreshes a stale installed block in place", (t) => {
  const { home, userHome } = isolatedHome(t);
  installInstructions(home, { userHome, locale: "ko" });
  const file = path.join(userHome, ".claude", "CLAUDE.md");
  // 블록을 구버전으로 오염 + 블록 밖 유저 내용 추가
  const stale = fs.readFileSync(file, "utf8").replace("기억을 먼저 확인한다", "기억을 먼저 확인한다(구버전)");
  fs.writeFileSync(file, `# 유저 상단 내용\n\n${stale}\n# 유저 하단 내용\n`, "utf8");

  const result = installInstructions(home, { userHome, locale: "ko" });
  assert.equal(result.changed, true);
  const refreshed = fs.readFileSync(file, "utf8");
  assert.ok(!refreshed.includes("(구버전)"));
  assert.ok(refreshed.includes("# 유저 상단 내용"));
  assert.ok(refreshed.includes("# 유저 하단 내용"));
  assert.equal(refreshed.split("<!-- nautli:instructions -->").length, 2); // 마커 중복 없음

  // 동일 내용 재실행은 무변경
  const again = installInstructions(home, { userHome, locale: "ko" });
  assert.equal(again.changed, false);
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

test("sample facts are auto-processed into cleanup history (zero-touch)", async (t) => {
  const { home } = isolatedHome(t);
  initStore(home);
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: [process.execPath, mockJudge],
    triage_cmd: false,
  })}\n`, "utf8");

  const seeded = seedSampleFacts(home);
  assert.equal(seeded.seeded, 4);
  await runDigestOnce(home);
  // Zero-touch: no cards in review queue, all auto-processed
  const cards = listCards(home);
  assert.equal(cards.length, 0);
  // Check undo ledger has entries for both duplicate and contradiction
  const { listUndoLedger } = await import("../src/core/review.js");
  const ledger = listUndoLedger(home);
  assert.ok(ledger.length >= 2, "undo ledger should have entries for auto-processed pairs");
  const verdicts = new Set(ledger.map((e) => e.verdict).filter(Boolean));
  assert.ok(verdicts.has("duplicate"), "should have auto-merged duplicate");
  assert.ok(verdicts.has("contradiction"), "should have shadowed contradiction");
  assert.equal(removeSampleFacts(home).removed, 4);
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

test("daemon plist preserves the installer shell PATH for AI CLI discovery", (t) => {
  const { home, userHome } = isolatedHome(t);
  const result = installDaemon(home, () => "ok\n", { userHome, uid: 501 });
  const plist = fs.readFileSync(result.plist, "utf8");

  assert.ok(plist.includes("<key>PATH</key>"));
  assert.ok(plist.includes(path.dirname(process.execPath)));
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

test("installApp installs dashboard service and app bundle", (t) => {
  const { home, userHome } = isolatedHome(t);
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    return "";
  };
  const result = installApp(home, runner, { userHome, uid: 501 });
  assert.equal(result.ok, true);
  assert.equal(result.launcher, "script");
  assert.equal(result.menubar, false);
  const plist = path.join(userHome, "Library", "LaunchAgents", `${DASHBOARD_LABEL}.plist`);
  const menubarPlist = path.join(userHome, "Library", "LaunchAgents", `${MENUBAR_LABEL}.plist`);
  assert.ok(fs.existsSync(plist));
  assert.ok(!fs.existsSync(menubarPlist));
  const plistBody = fs.readFileSync(plist, "utf8");
  assert.ok(plistBody.includes("<key>KeepAlive</key>"));
  assert.ok(plistBody.includes("--no-open"));
  const exe = path.join(userHome, "Applications", "nautli.app", "Contents", "MacOS", "nautli");
  assert.ok(fs.existsSync(exe));
  assert.ok(fs.statSync(exe).mode & 0o100);
  assert.ok(fs.readFileSync(exe, "utf8").includes("localhost:4600"));
  assert.ok(fs.existsSync(path.join(userHome, "Applications", "nautli.app", "Contents", "Info.plist")));
  assert.ok(calls.some(([cmd]) => cmd === "swiftc"));
  assert.ok(calls.some(([cmd, sub]) => cmd === "launchctl" && sub === "bootstrap"));
});

test("installApp installs and signs the native launcher when swiftc succeeds", (t) => {
  const { home, userHome } = isolatedHome(t);
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "swiftc") {
      fs.writeFileSync(args.at(-1), "FAKE_BINARY");
    }
    return "";
  };

  const result = installApp(home, runner, { userHome, uid: 501 });
  assert.equal(result.launcher, "native");
  assert.equal(result.menubar, true);
  assert.ok(calls.some(([cmd]) => cmd === "codesign"));
  const exe = path.join(result.app, "Contents", "MacOS", "nautli");
  assert.equal(fs.readFileSync(exe, "utf8"), "FAKE_BINARY");
  const menubarPlist = path.join(userHome, "Library", "LaunchAgents", `${MENUBAR_LABEL}.plist`);
  assert.ok(fs.existsSync(menubarPlist));
  const menubarExe = path.join(home, "bin", "nautli-menubar");
  assert.ok(fs.existsSync(menubarExe));
  assert.ok(fs.readFileSync(menubarPlist, "utf8").includes(
    menubarExe,
  ));
  assert.ok(!fs.existsSync(path.join(
    result.app,
    "Contents",
    "MacOS",
    "nautli-menubar",
  )));
  assert.ok(calls.some(([cmd, sub, , file]) => (
    cmd === "launchctl" && sub === "bootstrap" && file === menubarPlist
  )));
});

test("installApp retries bootstrap while launchctl drains a stale label", (t) => {
  const { home, userHome } = isolatedHome(t);
  let bootstrapCalls = 0;
  const runner = (command, args) => {
    if (command === "swiftc") {
      fs.writeFileSync(args.at(-1), "FAKE_BINARY");
    }
    if (command === "launchctl" && args[0] === "bootstrap") {
      bootstrapCalls += 1;
      if (bootstrapCalls <= 2) {
        throw new Error("Bootstrap failed: 5: Input/output error");
      }
    }
    return "";
  };

  const result = installApp(home, runner, { userHome, uid: 501 });
  assert.equal(result.ok, true);
  assert.ok(bootstrapCalls >= 3);
});

test("uninstallApp removes service plist and app bundle", (t) => {
  const { home, userHome } = isolatedHome(t);
  const runner = (command, args) => {
    if (command === "swiftc") fs.writeFileSync(args.at(-1), "FAKE_BINARY");
    return "";
  };
  installApp(home, runner, { userHome, uid: 501 });
  const result = uninstallApp(home, runner, { userHome, uid: 501 });
  assert.equal(result.ok, true);
  assert.ok(!fs.existsSync(path.join(userHome, "Library", "LaunchAgents", `${DASHBOARD_LABEL}.plist`)));
  assert.ok(!fs.existsSync(path.join(userHome, "Library", "LaunchAgents", `${MENUBAR_LABEL}.plist`)));
  assert.ok(!fs.existsSync(path.join(home, "bin", "nautli-menubar")));
  assert.ok(!fs.existsSync(path.join(userHome, "Applications", "nautli.app")));
});

test("digestFreshness keys on the last scheduled slot, not a 24h window", (t) => {
  const { home } = isolatedHome(t);
  const file = path.join(home, "daemon", "health.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 로컬타임 생성자 사용 — TZ 무관 결정적
  const fire = new Date(2026, 6, 16, 3, 30, 5); // 오늘 03:30:05 정기 발사
  const write = (entries) => fs.writeFileSync(file, entries.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");

  assert.equal(digestFreshness(home, { now: fire }).fresh, false);

  // 회귀 케이스: 어제 03:30:31 성공(24h - 26초 전) → 오늘 정기 실행은 돌아야 한다
  write([{ at: new Date(2026, 6, 15, 3, 30, 31).toISOString(), exit: 0 }]);
  assert.equal(digestFreshness(home, { now: fire }).fresh, false);

  // 오늘 슬롯 이후 성공 → 같은 날 RunAtLoad(부팅)는 스킵
  write([{ at: new Date(2026, 6, 16, 3, 31, 0).toISOString(), exit: 0 }]);
  assert.equal(digestFreshness(home, { now: new Date(2026, 6, 16, 9, 0, 0) }).fresh, true);

  // 성공 이후의 실패 기록은 catch-up 판단을 뒤집지 않는다
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date(2026, 6, 16, 5, 0, 0).toISOString(), exit: 1 })}\n`, "utf8");
  assert.equal(digestFreshness(home, { now: new Date(2026, 6, 16, 9, 0, 0) }).fresh, true);

  // 낮에 수동(--force) 성공 → 다음날 03:30 정기 실행은 새 슬롯이므로 돌아야 한다
  write([{ at: new Date(2026, 6, 16, 13, 0, 0).toISOString(), exit: 0 }]);
  assert.equal(digestFreshness(home, { now: new Date(2026, 6, 17, 3, 30, 5) }).fresh, false);
});

test("recordDigestSkip leaves a durable line that does not count as success", (t) => {
  const { home } = isolatedHome(t);
  const file = path.join(home, "daemon", "health.log");
  recordDigestSkip(home, "test skip");
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.skipped_run, true);
  assert.equal(entry.reason, "test skip");
  assert.ok(Number.isFinite(Date.parse(entry.at)));
  // 스킵 기록이 게이트를 연장하면 안 된다
  assert.equal(digestFreshness(home, { now: new Date(Date.parse(entry.at) + 1000) }).fresh, false);
});

test("runDigestOnce skips when another digestion holds the lock", async (t) => {
  const { home } = isolatedHome(t);
  initStore(home);
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: [process.execPath, mockJudge],
    triage_cmd: false,
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
