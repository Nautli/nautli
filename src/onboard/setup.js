import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync, spawn as spawnChild } from "node:child_process";
import { fileURLToPath } from "node:url";
import { remember } from "../core/gate.js";
import { withReviewLock } from "../core/review-lock.js";
import { ERR, STATUS } from "../core/schema.js";
import { DEFAULT_PATROL } from "../core/spool.js";
import { Store } from "../core/store.js";
import { runOnce } from "../daemon/pipeline.js";
import { makeT, resolveLocale } from "../i18n/strings.js";
import {
  INSTRUCTIONS_START,
  INSTRUCTIONS_END,
  instructionsFor,
} from "./instructions.js";

export const DAEMON_LABEL = "com.nautli.daemon";
export const DASHBOARD_LABEL = "com.nautli.dashboard";
export const MENUBAR_LABEL = "com.nautli.menubar";
export const DASHBOARD_PORT = 4600;
const CLI_FILE = fileURLToPath(new URL("../cli.js", import.meta.url));
const APP_ICON = fileURLToPath(
  new URL("../../assets/brand/nautli.icns", import.meta.url),
);
const APP_SWIFT_SRC = fileURLToPath(
  new URL("../../assets/macapp/nautli-app.swift", import.meta.url),
);
const MENUBAR_SWIFT_SRC = fileURLToPath(
  new URL("../../assets/macapp/nautli-menubar.swift", import.meta.url),
);
const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
  patrol: DEFAULT_PATROL,
});
const ALLOWED_COMMANDS = new Set([
  "claude",
  "codex",
  "launchctl",
  "osascript",
  "swiftc",
  "codesign",
]);

function translator(locale) {
  return makeT(locale ?? resolveLocale());
}

function codedError(code, message = code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function setupError(code, message, manualCommand, cause) {
  const error = codedError(code, message, cause);
  error.manual_command = manualCommand;
  return error;
}

function manualCommand(command, args) {
  return [command, ...args]
    .map((token) => {
      const value = String(token);
      return /\s/u.test(value)
        ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : value;
    })
    .join(" ");
}

function defaultRunner(command, args, options = {}) {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw codedError(
      ERR.E_INVALID_INPUT,
      translator()("setup.command_not_allowed", { command }),
    );
  }
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

function runnerText(runner, command, args, options) {
  const value = runner(command, args, options);
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
}

// launchctl bootout은 비동기 드레인이라 직후 bootstrap이 레이스로 실패할 수 있다 — 짧게 재시도.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function bootstrapWithRetry(runner, uid, plist, { attempts = 4, delayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      runnerText(runner, "launchctl", ["bootstrap", `gui/${uid}`, plist]);
      return;
    } catch (error) {
      lastError = error;
      sleepSync(delayMs);
    }
  }
  throw lastError;
}

function userPaths(userHome) {
  return {
    instructions: path.join(userHome, ".claude", "CLAUDE.md"),
    plist: path.join(
      userHome,
      "Library",
      "LaunchAgents",
      `${DAEMON_LABEL}.plist`,
    ),
    dashboardPlist: path.join(
      userHome,
      "Library",
      "LaunchAgents",
      `${DASHBOARD_LABEL}.plist`,
    ),
    menubarPlist: path.join(
      userHome,
      "Library",
      "LaunchAgents",
      `${MENUBAR_LABEL}.plist`,
    ),
    app: path.join(userHome, "Applications", "nautli.app"),
  };
}

export function readConfig(home) {
  const file = path.join(home, "config.json");
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    patrol: {
      ...DEFAULT_PATROL,
      ...(saved.patrol && typeof saved.patrol === "object" ? saved.patrol : {}),
    },
  };
}

export function writeConfig(home, updates = {}) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "config.json");
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const config = { ...readConfig(home), ...updates };

  try {
    fs.writeFileSync(tmp, `${JSON.stringify(config)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }

  return config;
}

function readHealth(home) {
  const file = path.join(home, "daemon", "health.log");
  if (!fs.existsSync(file)) {
    return {
      exists: false,
      healthy: false,
      last_run: null,
      age_ms: null,
      result: null,
    };
  }

  const lines = fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value.skipped_run) continue;
      const timestamp = Date.parse(value.at);
      if (!Number.isFinite(timestamp)) continue;
      const age = Math.max(0, Date.now() - timestamp);
      return {
        exists: true,
        healthy: value.exit === 0,
        stale: age > 24 * 60 * 60 * 1000,
        last_run: value.at,
        age_ms: age,
        result: value.result ?? null,
      };
    } catch {
      // launchd가 남긴 비-JSON 출력은 건너뛴다.
    }
  }

  return {
    exists: true,
    healthy: false,
    last_run: null,
    age_ms: null,
    result: null,
  };
}

export const DIGEST_SCHEDULE_HOUR = 2;
export const DIGEST_SCHEDULE_MINUTE = 0;

// 가장 최근의 예약 슬롯(매일 02:00) 시각. now가 02:00 이전이면 전날 02:00.
export function lastScheduledDigestAt(now = new Date()) {
  const boundary = new Date(now);
  boundary.setHours(DIGEST_SCHEDULE_HOUR, DIGEST_SCHEDULE_MINUTE, 0, 0);
  if (boundary > now) boundary.setDate(boundary.getDate() - 1);
  return boundary;
}

// anacron식 catch-up 게이트 — RunAtLoad(부팅/로그인)와 2:00 정기 실행이 공유한다.
// 가장 최근 예약 슬롯 이후에 이미 성공 소화가 있으면 이번 실행을 건너뛴다.
// (고정 24h 윈도우는 종료시각 기록 vs 정시 발사의 수십초 차로 다음날 정기 실행을 항상 스킵시켰다.)
export function digestFreshness(home, { now = new Date() } = {}) {
  const file = path.join(home, "daemon", "health.log");
  if (!fs.existsSync(file)) return { fresh: false, last_success_at: null, age_ms: null };

  const lines = fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value.skipped_run) continue;
      if (value.exit !== 0) continue;
      const timestamp = Date.parse(value.at);
      if (!Number.isFinite(timestamp)) continue;
      const age = Math.max(0, now.getTime() - timestamp);
      const fresh = timestamp >= lastScheduledDigestAt(now).getTime();
      return { fresh, last_success_at: value.at, age_ms: age };
    } catch {
      // launchd가 남긴 비-JSON 출력은 건너뛴다.
    }
  }

  return { fresh: false, last_success_at: null, age_ms: null };
}

function nextDigestAt(now = new Date()) {
  const next = new Date(now);
  next.setHours(DIGEST_SCHEDULE_HOUR, DIGEST_SCHEDULE_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function instructionInstalled(file) {
  return fs.existsSync(file)
    && fs.readFileSync(file, "utf8").includes(INSTRUCTIONS_START);
}

// `claude mcp list`는 원격 MCP 서버 헬스체크 핑까지 돌려 수 초 걸린다 —
// 2초 타임아웃에 걸려 등록을 놓쳤다(NA: "Claude Code 연결"이 영영 미완료로 뜸).
// 등록의 진짜 SSOT는 `claude mcp add -s user`가 쓰는 ~/.claude.json 이므로 그걸 직접 읽는다.
// 파일이 없을 때만(테스트/CLI 미실행) CLI 프로브로 폴백.
function claudeConfigRegistration(userHome = os.homedir()) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(userHome, ".claude.json"), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { cli_exists: true, registered: false };
  }
  const entry = parsed?.mcpServers?.nautli;
  const registered = Boolean(
    entry
    && Array.isArray(entry.args)
    && entry.args.includes("mcp"),
  );
  return { cli_exists: true, registered };
}

function claudeStatus(runner, userHome = os.homedir()) {
  const fromConfig = claudeConfigRegistration(userHome);
  if (fromConfig) return fromConfig;

  try {
    runnerText(
      runner,
      "claude",
      ["--version"],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
    );
  } catch {
    return { cli_exists: false, registered: false };
  }

  try {
    const list = runnerText(
      runner,
      "claude",
      ["mcp", "list"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    return {
      cli_exists: true,
      registered: /(^|\s)nautli(?:\s|:|$)/m.test(list),
    };
  } catch {
    return { cli_exists: true, registered: false };
  }
}

function codexStatus(runner) {
  try {
    runnerText(
      runner,
      "codex",
      ["--version"],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
    );
  } catch {
    return { cli_exists: false, registered: false };
  }

  try {
    const list = runnerText(
      runner,
      "codex",
      ["mcp", "list"],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
    );
    return {
      cli_exists: true,
      registered: /(^|\s)nautli(?:\s|:|$)/m.test(list),
    };
  } catch {
    return { cli_exists: true, registered: false };
  }
}

function daemonRegistered(runner, uid) {
  try {
    runnerText(
      runner,
      "launchctl",
      ["print", `gui/${uid}/${DAEMON_LABEL}`],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
    );
    return true;
  } catch {
    return false;
  }
}

function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", timeout: 2_000 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout ?? ""));
      },
    );
  });
}

export async function checkClaudeStatus(runner, userHome = os.homedir()) {
  const fromConfig = claudeConfigRegistration(userHome);
  if (fromConfig) return fromConfig;

  if (runner) {
    await new Promise((resolve) => setImmediate(resolve));
    return claudeStatus(runner, userHome);
  }

  try {
    await execFileText("claude", ["--version"]);
  } catch {
    return { cli_exists: false, registered: false };
  }

  try {
    const list = await execFileText("claude", ["mcp", "list"]);
    return {
      cli_exists: true,
      registered: /(^|\s)nautli(?:\s|:|$)/m.test(list),
    };
  } catch {
    return { cli_exists: true, registered: false };
  }
}

export async function checkCodexStatus(runner) {
  if (runner) {
    await new Promise((resolve) => setImmediate(resolve));
    return codexStatus(runner);
  }

  try {
    await execFileText("codex", ["--version"]);
  } catch {
    return { cli_exists: false, registered: false };
  }

  try {
    const list = await execFileText("codex", ["mcp", "list"]);
    return {
      cli_exists: true,
      registered: /(^|\s)nautli(?:\s|:|$)/m.test(list),
    };
  } catch {
    return { cli_exists: true, registered: false };
  }
}

function localDateTime(value) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? "";
  return [
    `${part("year")}-${part("month")}-${part("day")}`,
    `${part("hour")}:${part("minute")}:${part("second")}`,
  ].join(" ");
}

export function statusAll(home, {
  runner = defaultRunner,
  userHome = os.homedir(),
  uid = process.getuid?.() ?? 0,
  now = new Date(),
  checkClaude = true,
  checkCodex = checkClaude,
  claude: suppliedClaude,
  codex: suppliedCodex,
} = {}) {
  const {
    instructions,
    plist,
    dashboardPlist: dashboardPlistFile,
    app,
  } = userPaths(userHome);
  const claude = suppliedClaude ?? (
    checkClaude
      ? claudeStatus(runner, userHome)
      : { cli_exists: null, registered: null, status: "checking" }
  );
  const codex = suppliedCodex ?? (
    checkCodex
      ? codexStatus(runner)
      : { cli_exists: null, registered: null, status: "checking" }
  );
  const health = readHealth(home);
  const plistExists = fs.existsSync(plist);
  const registered = plistExists && daemonRegistered(runner, uid);
  const nextRun = new Date(nextDigestAt(now));

  const required = {
    store: {
      complete: fs.existsSync(path.join(home, "index.sqlite")),
    },
    mcp: {
      complete: claude.registered === true || codex.registered === true,
      cli_exists: claude.cli_exists,
      registered: claude.registered,
      ...(claude.status ? { status: claude.status } : {}),
      claude,
      codex,
    },
    instructions: {
      complete: instructionInstalled(instructions),
      file: instructions,
    },
    daemon: {
      complete: registered,
      plist_exists: plistExists,
      registered,
      plist,
      health,
      next_run: localDateTime(nextRun),
      next_run_ms: nextRun.getTime(),
    },
  };

  return {
    required,
    optional: {
      cursor: { complete: false, available: true },
      sample: { complete: sampleFacts(home).length > 0 },
    },
    app: {
      plist_exists: fs.existsSync(dashboardPlistFile),
      app_exists: fs.existsSync(app),
    },
    complete: Object.values(required).every((step) => step.complete),
  };
}

export function initStore(home) {
  fs.mkdirSync(home, { recursive: true });
  const store = new Store(home);
  store.close();

  let firstInstall = false;
  const config = path.join(home, "config.json");
  if (!fs.existsSync(config)) {
    const newInstallConfig = {
      ...DEFAULT_CONFIG,
      telemetry: { enabled: true },
    };
    fs.writeFileSync(config, `${JSON.stringify(newInstallConfig)}\n`, "utf8");
    firstInstall = true;
  }

  return {
    ok: true,
    home,
    index: path.join(home, "index.sqlite"),
    first_install: firstInstall,
  };
}

export function registerMcp(home, runner = defaultRunner, { locale } = {}) {
  const t = translator(locale);
  // -s user: 기본(local)이면 설치 폴더 밖 프로젝트에서 nautli MCP가 안 보인다
  // (NA-021 — "모든 프로젝트 공유" 약속의 핵심)
  const args = [
    "mcp",
    "add",
    "-s",
    "user",
    "nautli",
    "--",
    process.execPath,
    CLI_FILE,
    "mcp",
  ];
  const fallbackCommand = manualCommand("claude", args);

  try {
    runnerText(
      runner,
      "claude",
      ["--version"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (cause) {
    throw setupError(
      ERR.E_CLAUDE_CLI_MISSING,
      t("setup.claude_missing"),
      fallbackCommand,
      cause,
    );
  }

  try {
    runnerText(
      runner,
      "claude",
      args,
      { env: { ...process.env, NAUTLI_HOME: home } },
    );
  } catch (cause) {
    throw setupError(
      ERR.E_MCP_REGISTER_FAILED,
      t("setup.claude_mcp_failed"),
      fallbackCommand,
      cause,
    );
  }

  return { ok: true, command: ["claude", ...args] };
}

export function registerMcpCodex(home, runner = defaultRunner, { locale } = {}) {
  const t = translator(locale);
  const args = [
    "mcp",
    "add",
    "nautli",
    "--",
    process.execPath,
    CLI_FILE,
    "mcp",
  ];
  const fallbackCommand = manualCommand("codex", args);

  try {
    runnerText(
      runner,
      "codex",
      ["--version"],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 },
    );
  } catch (cause) {
    throw setupError(
      ERR.E_CODEX_CLI_MISSING,
      t("setup.codex_missing"),
      fallbackCommand,
      cause,
    );
  }

  try {
    runnerText(
      runner,
      "codex",
      args,
      { env: { ...process.env, NAUTLI_HOME: home } },
    );
  } catch (cause) {
    throw setupError(
      ERR.E_MCP_REGISTER_FAILED,
      t("setup.codex_mcp_failed"),
      fallbackCommand,
      cause,
    );
  }

  return { ok: true, command: ["codex", ...args] };
}

export function installInstructions(
  home,
  { userHome = os.homedir(), previewOnly = false, locale } = {},
) {
  void home;
  const t = translator(locale);
  const instructions = instructionsFor(locale ?? resolveLocale());
  const file = userPaths(userHome).instructions;
  const preview = t("setup.instructions_preview", {
    file,
    block: instructions,
  });

  if (previewOnly) {
    return {
      ok: true,
      installed: false,
      preview,
      block: instructions,
      file,
    };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";

  const start = current.indexOf(INSTRUCTIONS_START);
  if (start === -1) {
    const prefix = current === "" || current.endsWith("\n")
      ? current
      : `${current}\n`;
    fs.writeFileSync(
      file,
      `${prefix}${prefix === "" ? "" : "\n"}${instructions}\n`,
      "utf8",
    );
    return {
      ok: true,
      installed: true,
      changed: true,
      preview,
      block: instructions,
      file,
    };
  }

  const end = current.indexOf(INSTRUCTIONS_END, start);
  if (end === -1) {
    return {
      ok: false,
      installed: true,
      changed: false,
      reason: t("setup.instructions_broken_block", { file }),
      preview,
      block: instructions,
      file,
    };
  }

  const next = current.slice(0, start)
    + instructions
    + current.slice(end + INSTRUCTIONS_END.length);
  const changed = next !== current;
  if (changed) fs.writeFileSync(file, next, "utf8");

  return {
    ok: true,
    installed: true,
    changed,
    preview,
    block: instructions,
    file,
  };
}

export function removeInstructions(
  home,
  { userHome = os.homedir() } = {},
) {
  void home;
  const file = userPaths(userHome).instructions;
  if (!fs.existsSync(file)) {
    return { ok: true, removed: false, file };
  }

  const current = fs.readFileSync(file, "utf8");
  const start = current.indexOf(INSTRUCTIONS_START);
  const end = current.indexOf(INSTRUCTIONS_END, start);
  if (start < 0 || end < 0) {
    return { ok: true, removed: false, file };
  }

  const before = current.slice(0, start)
    .replace(/[ \t]+$/u, "")
    .replace(/\n{2,}$/u, "\n");
  const after = current.slice(end + INSTRUCTIONS_END.length)
    .replace(/^\s*\n/u, "");

  fs.writeFileSync(
    file,
    `${before}${after}`.replace(/^\n+|\n+$/gu, "") + (before || after ? "\n" : ""),
    "utf8",
  );

  return { ok: true, removed: true, file };
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// launchd는 최소 PATH로 잡을 띄워 nvm 등지의 claude/codex를 못 찾는다 —
// 설치는 유저 셸에서 실행되므로 그 시점의 PATH를 구워 넣는다.
// node 자신의 bin 디렉토리(nvm이면 claude도 대개 여기)를 선두에 보장.
function launchdPath() {
  const nodeBin = path.dirname(process.execPath);
  const base = process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return base.split(":").includes(nodeBin) ? base : `${nodeBin}:${base}`;
}

function daemonPlist(home) {
  const health = path.join(home, "daemon", "health.log");
  const spool = path.join(home, "daemon", "spool");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(CLI_FILE)}</string><string>daemon-run</string></array>
  <key>EnvironmentVariables</key><dict><key>NAUTLI_HOME</key><string>${xml(home)}</string><key>PATH</key><string>${xml(launchdPath())}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>WatchPaths</key><array><string>${xml(spool)}</string></array>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>${xml(health)}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(home, "daemon", "error.log"))}</string>
</dict></plist>
`;
}

function dashboardPlist(home) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${DASHBOARD_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(CLI_FILE)}</string><string>dashboard</string><string>--no-open</string></array>
  <key>EnvironmentVariables</key><dict><key>NAUTLI_HOME</key><string>${xml(home)}</string><key>PATH</key><string>${xml(launchdPath())}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(home, "daemon", "dashboard.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(home, "daemon", "dashboard.err"))}</string>
</dict></plist>
`;
}

function menubarPlist(home) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${MENUBAR_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(path.join(home, "bin", "nautli-menubar"))}</string></array>
  <key>EnvironmentVariables</key><dict><key>NAUTLI_HOME</key><string>${xml(home)}</string><key>PATH</key><string>${xml(launchdPath())}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(home, "daemon", "menubar.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(home, "daemon", "menubar.err"))}</string>
</dict></plist>
`;
}

function launcherScript() {
  return `#!/bin/bash
# 서버는 launchd(${DASHBOARD_LABEL})가 상시 유지한다. 여기는 문만 연다.
if ! nc -z 127.0.0.1 ${DASHBOARD_PORT} 2>/dev/null; then
  launchctl kickstart gui/$(id -u)/${DASHBOARD_LABEL} 2>/dev/null
  for i in $(seq 1 20); do nc -z 127.0.0.1 ${DASHBOARD_PORT} 2>/dev/null && break; sleep 0.5; done
fi
if [ -d "/Applications/Google Chrome.app" ]; then
  exec open -na "Google Chrome" --args --app=http://localhost:${DASHBOARD_PORT}
fi
exec open "http://localhost:${DASHBOARD_PORT}"
`;
}

function appInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${xml("nautli")}</string>
  <key>CFBundleDisplayName</key><string>${xml("nautli")}</string>
  <key>CFBundleIdentifier</key><string>${xml("ai.nautli.app")}</string>
  <key>CFBundleVersion</key><string>${xml("1.0")}</string>
  <key>CFBundleShortVersionString</key><string>${xml("1.0")}</string>
  <key>CFBundlePackageType</key><string>${xml("APPL")}</string>
  <key>CFBundleExecutable</key><string>${xml("nautli")}</string>
  <key>CFBundleIconFile</key><string>${xml("icon")}</string>
  <key>LSMinimumSystemVersion</key><string>${xml("11.0")}</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
`;
}

export function installDaemon(
  home,
  runner = defaultRunner,
  {
    userHome = os.homedir(),
    uid = process.getuid?.() ?? 0,
    locale,
  } = {},
) {
  const t = translator(locale);
  initStore(home);
  // WatchPaths 대상이 로드 시점에 없으면 launchd가 감시를 armed하지 못할 수 있다 — 미리 만든다.
  fs.mkdirSync(path.join(home, "daemon", "spool"), { recursive: true });
  const file = userPaths(userHome).plist;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, daemonPlist(home), "utf8");

  // 같은 라벨이 다른 plist 경로로 이미 로드돼 있으면 bootstrap이 error 5로 실패한다.
  // 선제 bootout으로 잔재를 걷어낸다(로드된 적 없으면 실패하는 게 정상 — 무시).
  try {
    runnerText(runner, "launchctl", ["bootout", `gui/${uid}/${DAEMON_LABEL}`]);
  } catch {
    // 미로드 상태의 bootout 실패는 무시한다.
  }

  const args = ["bootstrap", `gui/${uid}`, file];
  try {
    bootstrapWithRetry(runner, uid, file);
  } catch (cause) {
    throw setupError(
      ERR.E_LAUNCHCTL_FAILED,
      `${t("setup.daemon_failed")} ${t("setup.daemon_failed_conflict", { uid })}`,
      ["launchctl", ...args].join(" "),
      cause,
    );
  }

  return {
    ok: true,
    label: DAEMON_LABEL,
    plist: file,
  };
}

export function uninstallDaemon(
  home,
  runner = defaultRunner,
  {
    userHome = os.homedir(),
    uid = process.getuid?.() ?? 0,
  } = {},
) {
  void home;
  const file = userPaths(userHome).plist;

  if (fs.existsSync(file)) {
    try {
      runnerText(runner, "launchctl", [
        "bootout",
        `gui/${uid}`,
        file,
      ]);
    } finally {
      fs.rmSync(file, { force: true });
    }
    return { ok: true, removed: true, plist: file };
  }

  return { ok: true, removed: false, plist: file };
}

export function installApp(
  home,
  runner = defaultRunner,
  {
    userHome = os.homedir(),
    uid = process.getuid?.() ?? 0,
    locale,
  } = {},
) {
  const t = translator(locale);
  if (process.platform !== "darwin") {
    return { ok: false, reason: t("setup.app_darwin_only") };
  }

  initStore(home);
  const {
    dashboardPlist: plist,
    menubarPlist: menubarPlistFile,
    app,
  } = userPaths(userHome);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, dashboardPlist(home), "utf8");

  try {
    runnerText(runner, "launchctl", [
      "bootout",
      `gui/${uid}/${DASHBOARD_LABEL}`,
    ]);
  } catch {
    // 미로드 상태의 bootout 실패는 무시한다.
  }

  const args = ["bootstrap", `gui/${uid}`, plist];
  try {
    bootstrapWithRetry(runner, uid, plist);
  } catch (cause) {
    throw setupError(
      ERR.E_LAUNCHCTL_FAILED,
      `${t("setup.daemon_failed")} ${t("setup.daemon_failed_conflict", { uid })}`
        .replaceAll(DAEMON_LABEL, DASHBOARD_LABEL),
      ["launchctl", ...args].join(" "),
      cause,
    );
  }

  const contents = path.join(app, "Contents");
  const executable = path.join(contents, "MacOS", "nautli");
  const resources = path.join(contents, "Resources");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  // 런처 일원화(2026-07-16 유저 확정): 네이티브 WKWebView 래퍼가 기본.
  // 스크립트 런처는 크롬 앱모드 창이라 독에 크롬으로 잡힌다 — swiftc 부재/실패 시에만 폴백.
  let launcher = "script";
  if (fs.existsSync(APP_SWIFT_SRC)) {
    try {
      runnerText(runner, "swiftc", [
        "-O", "-framework", "Cocoa", "-framework", "WebKit",
        APP_SWIFT_SRC, "-o", executable,
      ]);
      if (fs.existsSync(executable)) launcher = "native";
    } catch {
      // swiftc 부재(Xcode CLT 미설치)·컴파일 실패 → 스크립트 폴백
    }
  }
  // 메뉴바 상주: 리뷰 카드 대기 뱃지. 네이티브 툴체인 있을 때만(스크립트 폴백 환경은 생략).
  const menubarExe = path.join(home, "bin", "nautli-menubar");
  let menubar = false;
  if (launcher === "native" && fs.existsSync(MENUBAR_SWIFT_SRC)) {
    fs.mkdirSync(path.join(home, "bin"), { recursive: true });
    try {
      runnerText(runner, "swiftc", ["-O", "-framework", "Cocoa", MENUBAR_SWIFT_SRC, "-o", menubarExe]);
      if (fs.existsSync(menubarExe)) {
        menubar = true;
        // 번들 안에 두면 LaunchServices가 메뉴바를 앱 인스턴스로 등록해 open이 메인 앱을 안 띄운다.
        fs.rmSync(path.join(contents, "MacOS", "nautli-menubar"), { force: true });
      }
    } catch {
      // 메뉴바는 부가 기능 — 실패해도 설치를 막지 않는다
    }
  }
  if (launcher === "script") {
    fs.writeFileSync(executable, launcherScript(), { encoding: "utf8", mode: 0o755 });
  }
  if (fs.existsSync(APP_ICON)) {
    fs.copyFileSync(APP_ICON, path.join(resources, "icon.icns"));
  }
  fs.writeFileSync(path.join(contents, "Info.plist"), appInfoPlist(), "utf8");
  if (launcher === "native") {
    try {
      runnerText(runner, "codesign", ["-s", "-", "--force", app]);
    } catch {
      // 서명 실패는 치명 아님 — 로컬 빌드는 대개 무서명으로도 실행된다.
    }
  }
  if (menubar) {
    try {
      runnerText(runner, "codesign", ["-s", "-", "--force", menubarExe]);
    } catch {
      // 메뉴바 서명 실패도 치명 아님 — 로컬 애드혹 서명은 최선 노력이다.
    }
  }

  if (menubar) {
    fs.writeFileSync(menubarPlistFile, menubarPlist(home), "utf8");
    try {
      runnerText(runner, "launchctl", [
        "bootout",
        `gui/${uid}/${MENUBAR_LABEL}`,
      ]);
    } catch {
      // 미로드 상태의 bootout 실패는 무시한다.
    }
    try {
      bootstrapWithRetry(runner, uid, menubarPlistFile);
    } catch {
      // 메뉴바는 부가 기능 — 등록 실패해도 설치를 막지 않는다.
      menubar = false;
    }
  }

  return {
    ok: true,
    service: { label: DASHBOARD_LABEL, plist },
    app,
    port: DASHBOARD_PORT,
    launcher,
    menubar,
  };
}

export function uninstallApp(
  home,
  runner = defaultRunner,
  {
    userHome = os.homedir(),
    uid = process.getuid?.() ?? 0,
  } = {},
) {
  const {
    dashboardPlist: plist,
    menubarPlist: menubarPlistFile,
    app,
  } = userPaths(userHome);
  const removed = {
    plist: fs.existsSync(plist),
    app: fs.existsSync(app),
  };

  try {
    runnerText(runner, "launchctl", [
      "bootout",
      `gui/${uid}/${DASHBOARD_LABEL}`,
    ]);
  } catch {
    // 미로드 상태의 bootout 실패는 무시한다.
  }

  try {
    runnerText(runner, "launchctl", [
      "bootout",
      `gui/${uid}/${MENUBAR_LABEL}`,
    ]);
  } catch {
    // 미로드 상태의 bootout 실패는 무시한다.
  }

  fs.rmSync(plist, { force: true });
  fs.rmSync(menubarPlistFile, { force: true });
  fs.rmSync(path.join(home, "bin", "nautli-menubar"), { force: true });
  fs.rmSync(app, { recursive: true, force: true });
  return { ok: true, removed };
}

function appendHealth(home, value) {
  const file = path.join(home, "daemon", "health.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

// 소화 결과를 macOS 알림으로 푸시 — 유일한 능동 채널(대시보드·리포트는 pull).
// 인젝션 방지: 문자열을 osascript 스크립트에 보간하지 않고 argv로 넘긴다.
// 알림 실패는 소화 결과에 영향을 주면 안 된다(전부 삼킴).
function localDay(now) {
  const date = now instanceof Date ? now : new Date(now);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readNotifyState(home) {
  try {
    if (typeof home !== "string" || home.length === 0) throw new Error("missing home");
    const value = JSON.parse(fs.readFileSync(path.join(home, "daemon", "notify-state.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid state");
    return {
      ok: true,
      state: {
        last_success_day: typeof value.last_success_day === "string" ? value.last_success_day : null,
        last_failure_day: typeof value.last_failure_day === "string" ? value.last_failure_day : null,
        accum_applied: Number.isFinite(value.accum_applied) && value.accum_applied >= 0
          ? value.accum_applied
          : 0,
      },
    };
  } catch {
    return {
      ok: false,
      state: { last_success_day: null, last_failure_day: null, accum_applied: 0 },
    };
  }
}

function writeNotifyState(home, state) {
  let temporary;
  try {
    const file = path.join(home, "daemon", "notify-state.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
    fs.renameSync(temporary, file);
    return true;
  } catch {
    try {
      if (temporary) fs.rmSync(temporary, { force: true });
    } catch {
      // 상태 정리 실패도 알림 결과에는 영향을 주지 않는다.
    }
    return false;
  }
}

export function notifyDigestResult(result, {
  runner = defaultRunner,
  locale,
  config = {},
  home,
  now = new Date(),
  platform = process.platform,
} = {}) {
  if (platform !== "darwin") return { notified: false, reason: "platform" };
  if (config.notifications === false) return { notified: false, reason: "disabled" };
  if (!result || result.skipped_run) return { notified: false, reason: "skipped_run" };
  const t = translator(locale);
  const failed = result.ok === false;
  const applied = result.applied ?? 0;
  const held = result.shadowed ?? 0;
  const today = localDay(now);
  const guard = readNotifyState(home);
  let notificationApplied = applied;

  if (failed && guard.ok && guard.state.last_failure_day === today) {
    return { notified: false, reason: "daily_cap" };
  }
  if (!failed && applied <= 0) return { notified: false, reason: "no_changes" };
  if (!failed) {
    notificationApplied = guard.state.accum_applied + applied;
    if (guard.ok && guard.state.last_success_day === today) {
      const saved = writeNotifyState(home, {
        ...guard.state,
        accum_applied: notificationApplied,
      });
      if (saved) return { notified: false, reason: "daily_cap" };
    }
  }

  // 카피 선택: 순찰 공식(잡았다→막았다). 질문 큐 폐지 후라 pending/answer CTA는 없다.
  let body;
  if (result.limit_wait) body = t("daemon.notify.limit_wait_body");
  else if (failed) body = t("daemon.notify.failed_body");
  else if (result.partial === true) body = t("daemon.notify.partial_body");
  else if (applied > 0 && held > 0) {
    body = t("daemon.notify.caught_held_body", {
      applied: notificationApplied,
      held,
      mem: notificationApplied === 1 ? "memory" : "memories",
    });
  } else if (applied > 0) {
    body = t("daemon.notify.caught_body", {
      applied: notificationApplied,
      mem: notificationApplied === 1 ? "memory" : "memories",
    });
  } else if (held > 0) {
    body = t("daemon.notify.held_body", { held, chg: held === 1 ? "change" : "changes" });
  } else {
    body = t("daemon.notify.clear_body");
  }
  const title = t("daemon.notify.title");
  try {
    runnerText(runner, "osascript", [
      "-e", "on run argv",
      "-e", "display notification (item 1 of argv) with title (item 2 of argv)",
      "-e", "end run",
      body, title,
    ]);
    if (failed) {
      writeNotifyState(home, {
        ...guard.state,
        last_failure_day: today,
      });
    } else {
      writeNotifyState(home, {
        ...guard.state,
        last_success_day: today,
        accum_applied: 0,
      });
    }
    return { notified: true };
  } catch {
    // 상태파일이 없던 최초 실행(guard.ok false)에서도 누적은 보존한다 — 파일은 여기서 생성된다.
    if (!failed) {
      writeNotifyState(home, { ...guard.state, accum_applied: notificationApplied });
    }
    return { notified: false, reason: "osascript_failed" };
  }
}

// 연속 실패 시 디스코드 에스컬레이션 — macOS 알림은 daily cap으로 묻히므로 별도 채널.
// health.log의 최근 N일분 실행을 역순 탐색해 연속 실패 일수를 센다.
const ESCALATION_CONSECUTIVE_DAYS = 2;

export function checkAndEscalate(home, {
  runner = defaultRunner,
  now = new Date(),
  threshold = ESCALATION_CONSECUTIVE_DAYS,
} = {}) {
  const file = path.join(home, "daemon", "health.log");
  if (!fs.existsSync(file)) return { escalated: false, reason: "no_health_log" };

  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
  // 날짜별 최종 exit 상태 수집 (역순)
  const dayResults = new Map();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.skipped_run) continue;
      if (entry.exit === undefined) continue;
      const day = localDay(new Date(entry.at));
      if (!dayResults.has(day)) dayResults.set(day, entry.exit);
    } catch { /* skip malformed */ }
  }

  // 오늘부터 역순으로 연속 실패 일수
  let consecutiveFails = 0;
  const today = localDay(now);
  const checkDate = new Date(now);
  for (let d = 0; d < 14; d += 1) {
    const day = localDay(checkDate);
    const exit = dayResults.get(day);
    if (exit === 0) break; // 성공 있으면 연속 끊김
    if (exit !== undefined && exit !== 0) consecutiveFails += 1;
    else if (d > 0) break; // 기록 없는 날은 연속 끊김 (오늘 제외)
    checkDate.setDate(checkDate.getDate() - 1);
  }

  if (consecutiveFails < threshold) return { escalated: false, consecutiveFails };

  // 에스컬레이션 일일 1회 cap
  const stateFile = path.join(home, "daemon", "escalation-state.json");
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.last_escalation_day === today) {
      return { escalated: false, reason: "daily_cap", consecutiveFails };
    }
  } catch { /* no state yet */ }

  // 최근 에러 요약
  let lastError = "unknown";
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.exit === 1) {
        lastError = entry.error_detail
          ? `${entry.error_detail.code ?? ""}: ${entry.error_detail.message ?? ""}`
          : (entry.error ?? "unknown");
        break;
      }
    } catch { /* skip */ }
  }

  const msg = `⚠️ nautli 소화 데몬 ${consecutiveFails}일 연속 실패\n에러: ${lastError}\n확인: ~/.nautli/daemon/health.log`;
  const discordBin = process.env.NAUTLI_DISCORD_BIN ?? path.join(os.homedir(), ".local", "bin", "discord-notify");
  try {
    // defaultRunner의 ALLOWED_COMMANDS를 우회 — discord-notify는 데몬 인프라 명령이지
    // nautli 설치 도구(claude/launchctl/osascript)가 아니라 allowlist에 넣지 않는다.
    // 테스트에서는 runner 주입으로 검증한다.
    if (runner === defaultRunner) {
      execFileSync(discordBin, ["general", msg], { encoding: "utf8", stdio: "ignore" });
    } else {
      runner(discordBin, ["general", msg]);
    }
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ last_escalation_day: today }), "utf8");
    return { escalated: true, consecutiveFails };
  } catch {
    return { escalated: false, reason: "discord_failed", consecutiveFails };
  }
}

// 스킵도 health.log에 1줄 남긴다. exit 필드를 일부러 넣지 않는다 —
// digestFreshness가 이 기록을 성공으로 오인해 게이트를 연장하면 안 된다.
export function recordDigestSkip(home, reason, trigger) {
  appendHealth(home, {
    at: new Date().toISOString(),
    skipped_run: true,
    ...(trigger ? { trigger } : {}),
    reason,
  });
}

const DIGEST_LOCK_STALE_MS = 3 * 60 * 60 * 1000;

// 동시 소화 방지 락 — setup --yes의 digest 스텝과 RunAtLoad 트리거가 겹칠 수 있다.
function acquireDigestLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (age < DIGEST_LOCK_STALE_MS) return false;
      fs.rmSync(file, { force: true });
    }
  }
  return false;
}

export async function runDigestOnce(home, { dry = false, locale, trigger } = {}) {
  const t = translator(locale);
  initStore(home);
  const lockFile = path.join(home, "daemon", "run.lock");
  if (!acquireDigestLock(lockFile)) {
    return { ok: true, skipped_run: true, reason: t("setup.digest_already_running") };
  }

  const store = new Store(home);

  // 스모크: rebuild/open 후 인덱스 왕복 확인 — 깨진 인덱스로 파이프라인 진입 방지.
  try {
    store.query({ limit: 1 });
  } catch (smokeErr) {
    store.close();
    fs.rmSync(lockFile, { force: true });
    const detail = {
      code: smokeErr?.code ?? undefined,
      message: smokeErr?.message ?? String(smokeErr),
      stack: (smokeErr?.stack ?? "").split("\n").find((l) => l.trimStart().startsWith("at "))?.trim() ?? null,
    };
    appendHealth(home, {
      at: new Date().toISOString(),
      exit: 1,
      phase: "store_smoke",
      ...(trigger ? { trigger } : {}),
      error: detail.code ?? detail.message,
      error_detail: detail,
    });
    throw smokeErr;
  }

  try {
    const result = await runOnce(store, home, readConfig(home), { dry });

    // Rate limit: distinct from general failure — schedule deferred retry
    if (!dry && result.rate_limited) {
      const retryAt = result.retry_at instanceof Date ? result.retry_at : null;
      const retryAtIso = retryAt ? retryAt.toISOString() : null;
      const fallbackMs = 90 * 60_000; // 1.5h backoff if no reset time parsed
      const delayMs = retryAt
        ? Math.max(60_000, retryAt.getTime() - Date.now() + 60_000) // 1min after reset
        : fallbackMs;

      const limitResult = {
        ok: false,
        limit_wait: true,
        retry_at: retryAtIso,
        retry_delay_ms: delayMs,
        reason: t("setup.digest_rate_limited", { retry_at: retryAtIso ?? "~1.5h" }),
        ...result,
        ...(trigger ? { trigger } : {}),
      };

      appendHealth(home, {
        at: new Date().toISOString(),
        exit: 1,
        limit_wait: true,
        retry_at: retryAtIso,
        result: limitResult,
      });

      // Schedule deferred spool touch to re-trigger daemon after limit resets
      scheduleRetryTouch(home, delayMs);

      return limitResult;
    }

    const failed = !dry && result.pairs > 0 && result.judgments === 0;

    if (failed) {
      const batchReason = result.judge_errors?.[0]?.reason;
      const reason = batchReason
        ? t("setup.digest_judge_failed", { reason: batchReason })
        : t("setup.digest_no_result");
      const failure = { ok: false, reason, ...result, ...(trigger ? { trigger } : {}) };

      appendHealth(home, {
        at: new Date().toISOString(),
        exit: 1,
        result: failure,
        error: reason,
      });
      return failure;
    }

    const judgeErrors = Array.isArray(result.judge_errors) ? result.judge_errors : [];
    const success = {
      ok: true,
      ...result,
      ...(trigger ? { trigger } : {}),
      ...(judgeErrors.length > 0 ? { partial: true, judge_errors: judgeErrors } : {}),
    };
    appendHealth(home, {
      at: new Date().toISOString(),
      exit: 0,
      result: success,
    });
    return success;
  } catch (error) {
    const code = error?.code ?? undefined;
    const message = error?.message ?? String(error);
    // stack 첫 의미있는 줄(호출위치)만 남긴다 — 전체 stack은 launchd stderr로 간다.
    const stackLine = (error?.stack ?? "")
      .split("\n")
      .find((line) => line.trimStart().startsWith("at "));
    appendHealth(home, {
      at: new Date().toISOString(),
      exit: 1,
      ...(trigger ? { trigger } : {}),
      error: code ?? message,
      error_detail: { code, message, stack: stackLine?.trim() ?? null },
    });
    throw error;
  } finally {
    store.close();
    fs.rmSync(lockFile, { force: true });
  }
}

// Touch spool after delay to re-trigger launchd daemon (WatchPaths).
// Spawns a detached shell process so the main daemon can exit.
export function scheduleRetryTouch(home, delayMs) {
  const spoolDir = path.join(home, "daemon", "spool");
  const delaySec = Math.ceil(delayMs / 1000);
  const markerPath = path.join(spoolDir, `${Date.now() + delayMs}-retry.marker`);
  try {
    const child = spawnChild("/bin/sh", [
      "-c",
      `sleep ${delaySec} && mkdir -p '${spoolDir.replace(/'/gu, "'\\''")}' && touch '${markerPath.replace(/'/gu, "'\\''")}'`,
    ], { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // Best-effort: if scheduling fails, next 3:30 cron will still run
  }
}

function sampleFacts(home) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) return [];
  const store = new Store(home);
  try {
    return store.query()
      .filter((fact) => fact.provenance?.source === "sample");
  } finally {
    store.close();
  }
}

export function seedSampleFacts(home) {
  initStore(home);
  const store = new Store(home);
  const config = readConfig(home);

  try {
    if (
      store.query().some(
        (fact) => fact.provenance?.source === "sample"
          && fact.status === STATUS.ACTIVE,
      )
    ) {
      return {
        ok: true,
        seeded: 0,
        facts: sampleFacts(home).map((fact) => fact.id),
      };
    }

    const t = makeT(resolveLocale());
    const inputs = [
      {
        claim: t("sample.duplicate_a"),
        scope: "project:sample-duplicate",
        t_valid: "2026-01-01",
      },
      {
        claim: t("sample.duplicate_b"),
        scope: "project:sample-duplicate",
        t_valid: "2026-01-02",
      },
      {
        claim: t("sample.contradiction_a"),
        scope: "project:sample-contradiction",
        t_valid: "2026-01-01",
      },
      {
        claim: t("sample.contradiction_b"),
        scope: "project:sample-contradiction",
        t_valid: "2026-01-02",
      },
    ];

    const ids = inputs.map((input) => remember(store, {
      ...input,
      source: "sample",
      confidence: 0.9,
    }, config)).map((result) => result.id);

    return {
      ok: true,
      seeded: ids.length,
      facts: ids,
    };
  } finally {
    store.close();
  }
}

export function removeSampleFacts(home) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) {
    return { ok: true, removed: 0 };
  }

  const store = new Store(home);
  let removed = 0;
  const ids = new Set();

  try {
    for (const fact of store.query()) {
      if (fact.provenance?.source !== "sample") continue;
      ids.add(fact.id);
      if (fact.status === STATUS.ACTIVE) {
        store.transition(fact.id, STATUS.ARCHIVED, {}, "daemon");
        removed += 1;
      }
    }
  } finally {
    store.close();
  }

  const queue = path.join(home, "review", "queue.jsonl");
  if (fs.existsSync(queue) && ids.size > 0) {
    withReviewLock(home, () => {
      const kept = fs.readFileSync(queue, "utf8")
        .split("\n")
        .filter((line) => {
          if (line.trim() === "") return false;
          try {
            return !String(JSON.parse(line).pair_id ?? "")
              .split(":")
              .some((id) => ids.has(id));
          } catch {
            return true;
          }
        });

      const tmp = `${queue}.tmp-${process.pid}`;
      fs.writeFileSync(
        tmp,
        kept.length === 0 ? "" : `${kept.join("\n")}\n`,
        "utf8",
      );
      fs.renameSync(tmp, queue);
    });
  }

  return { ok: true, removed };
}
