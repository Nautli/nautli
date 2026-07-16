import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { remember } from "../core/gate.js";
import { withReviewLock } from "../core/review-lock.js";
import { ERR, STATUS } from "../core/schema.js";
import { Store } from "../core/store.js";
import { runOnce } from "../daemon/pipeline.js";
import { makeT, resolveLocale } from "../i18n/strings.js";
import {
  INSTRUCTIONS_START,
  INSTRUCTIONS_END,
  instructionsFor,
} from "./instructions.js";

export const DAEMON_LABEL = "com.nautli.daemon";
const CLI_FILE = fileURLToPath(new URL("../cli.js", import.meta.url));
const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
});
const ALLOWED_COMMANDS = new Set(["claude", "codex", "launchctl"]);

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

function userPaths(userHome) {
  return {
    instructions: path.join(userHome, ".claude", "CLAUDE.md"),
    plist: path.join(
      userHome,
      "Library",
      "LaunchAgents",
      `${DAEMON_LABEL}.plist`,
    ),
  };
}

export function readConfig(home) {
  const file = path.join(home, "config.json");
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  return {
    ...DEFAULT_CONFIG,
    ...JSON.parse(fs.readFileSync(file, "utf8")),
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

export const DIGEST_SCHEDULE_HOUR = 3;
export const DIGEST_SCHEDULE_MINUTE = 30;

// 가장 최근의 예약 슬롯(매일 03:30) 시각. now가 03:30 이전이면 전날 03:30.
export function lastScheduledDigestAt(now = new Date()) {
  const boundary = new Date(now);
  boundary.setHours(DIGEST_SCHEDULE_HOUR, DIGEST_SCHEDULE_MINUTE, 0, 0);
  if (boundary > now) boundary.setDate(boundary.getDate() - 1);
  return boundary;
}

// anacron식 catch-up 게이트 — RunAtLoad(부팅/로그인)와 3:30 정기 실행이 공유한다.
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

function claudeStatus(runner) {
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

export async function checkClaudeStatus(runner) {
  if (runner) {
    await new Promise((resolve) => setImmediate(resolve));
    return claudeStatus(runner);
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
  const { instructions, plist } = userPaths(userHome);
  const claude = suppliedClaude ?? (
    checkClaude
      ? claudeStatus(runner)
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
    complete: Object.values(required).every((step) => step.complete),
  };
}

export function initStore(home) {
  fs.mkdirSync(home, { recursive: true });
  const store = new Store(home);
  store.close();

  const config = path.join(home, "config.json");
  if (!fs.existsSync(config)) {
    fs.writeFileSync(config, `${JSON.stringify(DEFAULT_CONFIG)}\n`, "utf8");
  }

  return {
    ok: true,
    home,
    index: path.join(home, "index.sqlite"),
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

function daemonPlist(home) {
  const health = path.join(home, "daemon", "health.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(CLI_FILE)}</string><string>daemon-run</string></array>
  <key>EnvironmentVariables</key><dict><key>NAUTLI_HOME</key><string>${xml(home)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(health)}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(home, "daemon", "error.log"))}</string>
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
    runnerText(runner, "launchctl", args);
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

function appendHealth(home, value) {
  const file = path.join(home, "daemon", "health.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

// 스킵도 health.log에 1줄 남긴다. exit 필드를 일부러 넣지 않는다 —
// digestFreshness가 이 기록을 성공으로 오인해 게이트를 연장하면 안 된다.
export function recordDigestSkip(home, reason) {
  appendHealth(home, { at: new Date().toISOString(), skipped_run: true, reason });
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

export async function runDigestOnce(home, { dry = false, locale } = {}) {
  const t = translator(locale);
  initStore(home);
  const lockFile = path.join(home, "daemon", "run.lock");
  if (!acquireDigestLock(lockFile)) {
    return { ok: true, skipped_run: true, reason: t("setup.digest_already_running") };
  }

  const store = new Store(home);

  try {
    const result = await runOnce(store, home, readConfig(home), { dry });
    const failed = !dry && (
      (result.pairs > 0 && result.judgments === 0)
      || (
        Array.isArray(result.judge_errors)
        && result.judge_errors.length > 0
      )
    );

    if (failed) {
      const batchReason = result.judge_errors?.[0]?.reason;
      const reason = batchReason
        ? t("setup.digest_judge_failed", { reason: batchReason })
        : t("setup.digest_no_result");
      const failure = { ok: false, reason, ...result };

      appendHealth(home, {
        at: new Date().toISOString(),
        exit: 1,
        result: failure,
        error: reason,
      });
      return failure;
    }

    appendHealth(home, {
      at: new Date().toISOString(),
      exit: 0,
      result,
    });
    return { ok: true, ...result };
  } catch (error) {
    appendHealth(home, {
      at: new Date().toISOString(),
      exit: 1,
      error: error?.code ?? error?.message ?? String(error),
    });
    throw error;
  } finally {
    store.close();
    fs.rmSync(lockFile, { force: true });
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

    const inputs = [
      {
        claim: "체험용 검토중복 메모: 회의 요약은 팀 문서에 기록한다",
        scope: "project:sample-duplicate",
        t_valid: "2026-01-01",
      },
      {
        claim: "체험용 검토중복 메모: 팀 문서에 회의 요약을 기록한다",
        scope: "project:sample-duplicate",
        t_valid: "2026-01-02",
      },
      {
        claim: "체험용 서비스 포트는 3100이다",
        scope: "project:sample-contradiction",
        t_valid: "2026-01-01",
      },
      {
        claim: "체험용 서비스 포트는 3200으로 변경되었다",
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
