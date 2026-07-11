import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { remember } from "../core/gate.js";
import { ERR, STATUS } from "../core/schema.js";
import { Store } from "../core/store.js";
import { runOnce } from "../daemon/pipeline.js";
import {
  AI_INSTRUCTIONS,
  INSTRUCTIONS_PREVIEW,
  INSTRUCTIONS_START,
  INSTRUCTIONS_END,
} from "./instructions.js";

export const DAEMON_LABEL = "com.nightmerge.daemon";
const CLI_FILE = fileURLToPath(new URL("../cli.js", import.meta.url));
const DEFAULT_CONFIG = Object.freeze({ default_scope: "person", judge_cmd: null });
const ALLOWED_COMMANDS = new Set(["claude", "launchctl"]);

function codedError(code, message = code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function defaultRunner(command, args, options = {}) {
  if (!ALLOWED_COMMANDS.has(command)) throw codedError(ERR.E_INVALID_INPUT, `Command not allowed: ${command}`);
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

function runnerText(runner, command, args, options) {
  const value = runner(command, args, options);
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
}

function userPaths(userHome) {
  return {
    instructions: path.join(userHome, ".claude", "CLAUDE.md"),
    plist: path.join(userHome, "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`),
  };
}

function readConfig(home) {
  const file = path.join(home, "config.json");
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

function readHealth(home) {
  const file = path.join(home, "daemon", "health.log");
  if (!fs.existsSync(file)) return { exists: false, healthy: false, last_run: null, age_ms: null };
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "");
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
      };
    } catch {
      // launchd가 남긴 비-JSON 출력은 건너뛴다.
    }
  }
  return { exists: true, healthy: false, last_run: null, age_ms: null };
}

function nextDigestAt(now = new Date()) {
  const next = new Date(now);
  next.setHours(3, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function instructionInstalled(file) {
  return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(INSTRUCTIONS_START);
}

function claudeStatus(runner) {
  try {
    runnerText(runner, "claude", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return { cli_exists: false, registered: false };
  }
  try {
    const list = runnerText(runner, "claude", ["mcp", "list"], { stdio: ["ignore", "pipe", "ignore"] });
    return { cli_exists: true, registered: /(^|\s)nightmerge(?:\s|:|$)/m.test(list) };
  } catch {
    return { cli_exists: true, registered: false };
  }
}

export function statusAll(home, { runner = defaultRunner, userHome = os.homedir(), now = new Date() } = {}) {
  const { instructions, plist } = userPaths(userHome);
  const claude = claudeStatus(runner);
  const health = readHealth(home);
  const required = {
    store: { complete: fs.existsSync(path.join(home, "index.sqlite")) },
    mcp: { complete: claude.cli_exists && claude.registered, ...claude },
    instructions: { complete: instructionInstalled(instructions), file: instructions },
    daemon: {
      complete: fs.existsSync(plist) && health.healthy,
      plist_exists: fs.existsSync(plist),
      plist,
      health,
      next_run: nextDigestAt(now),
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
  if (!fs.existsSync(config)) fs.writeFileSync(config, `${JSON.stringify(DEFAULT_CONFIG)}\n`, "utf8");
  return { ok: true, home, index: path.join(home, "index.sqlite") };
}

export function registerMcp(home, runner = defaultRunner) {
  const args = ["mcp", "add", "nightmerge", "--", process.execPath, CLI_FILE, "mcp"];
  runnerText(runner, "claude", args, { env: { ...process.env, NIGHTMERGE_HOME: home } });
  return { ok: true, command: ["claude", ...args] };
}

export function installInstructions(home, { userHome = os.homedir(), previewOnly = false } = {}) {
  void home;
  const file = userPaths(userHome).instructions;
  const preview = INSTRUCTIONS_PREVIEW;
  if (previewOnly) return { ok: true, installed: false, preview, file };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!current.includes(INSTRUCTIONS_START)) {
    const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
    fs.writeFileSync(file, `${prefix}${prefix === "" ? "" : "\n"}${AI_INSTRUCTIONS}\n`, "utf8");
  }
  return { ok: true, installed: true, changed: !current.includes(INSTRUCTIONS_START), preview, file };
}

export function removeInstructions(home, { userHome = os.homedir() } = {}) {
  void home;
  const file = userPaths(userHome).instructions;
  if (!fs.existsSync(file)) return { ok: true, removed: false, file };
  const current = fs.readFileSync(file, "utf8");
  const start = current.indexOf(INSTRUCTIONS_START);
  const end = current.indexOf(INSTRUCTIONS_END, start);
  if (start < 0 || end < 0) return { ok: true, removed: false, file };
  const before = current.slice(0, start).replace(/[ \t]+$/u, "").replace(/\n{2,}$/u, "\n");
  const after = current.slice(end + INSTRUCTIONS_END.length).replace(/^\s*\n/u, "");
  fs.writeFileSync(file, `${before}${after}`.replace(/^\n+|\n+$/gu, "") + (before || after ? "\n" : ""), "utf8");
  return { ok: true, removed: true, file };
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function daemonPlist(home) {
  const health = path.join(home, "daemon", "health.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${DAEMON_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(CLI_FILE)}</string><string>daemon-run</string></array>
  <key>EnvironmentVariables</key><dict><key>NIGHTMERGE_HOME</key><string>${xml(home)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>${xml(health)}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(home, "daemon", "error.log"))}</string>
</dict></plist>
`;
}

export function installDaemon(home, runner = defaultRunner, { userHome = os.homedir(), uid = process.getuid?.() ?? 0 } = {}) {
  initStore(home);
  const file = userPaths(userHome).plist;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, daemonPlist(home), "utf8");
  runnerText(runner, "launchctl", ["bootstrap", `gui/${uid}`, file]);
  return { ok: true, label: DAEMON_LABEL, plist: file };
}

export function uninstallDaemon(home, runner = defaultRunner, { userHome = os.homedir(), uid = process.getuid?.() ?? 0 } = {}) {
  void home;
  const file = userPaths(userHome).plist;
  if (fs.existsSync(file)) {
    try {
      runnerText(runner, "launchctl", ["bootout", `gui/${uid}`, file]);
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

export async function runDigestOnce(home, { dry = false } = {}) {
  initStore(home);
  const store = new Store(home);
  try {
    const result = await runOnce(store, home, readConfig(home), { dry });
    appendHealth(home, { at: new Date().toISOString(), exit: 0, result });
    return { ok: true, ...result };
  } catch (error) {
    appendHealth(home, { at: new Date().toISOString(), exit: 1, error: error?.code ?? error?.message ?? String(error) });
    throw error;
  } finally {
    store.close();
  }
}

function sampleFacts(home) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) return [];
  const store = new Store(home);
  try {
    return store.query().filter((fact) => fact.provenance?.source === "sample");
  } finally {
    store.close();
  }
}

export function seedSampleFacts(home) {
  initStore(home);
  const store = new Store(home);
  const config = readConfig(home);
  try {
    if (store.query().some((fact) => fact.provenance?.source === "sample" && fact.status === STATUS.ACTIVE)) {
      return { ok: true, seeded: 0, facts: sampleFacts(home).map((fact) => fact.id) };
    }
    const inputs = [
      { claim: "체험용 검토중복 메모: 회의 요약은 팀 문서에 기록한다", scope: "project:sample-duplicate", t_valid: "2026-01-01" },
      { claim: "체험용 검토중복 메모: 팀 문서에 회의 요약을 기록한다", scope: "project:sample-duplicate", t_valid: "2026-01-02" },
      { claim: "체험용 서비스 포트는 3100이다", scope: "project:sample-contradiction", t_valid: "2026-01-01" },
      { claim: "체험용 서비스 포트는 3200으로 변경되었다", scope: "project:sample-contradiction", t_valid: "2026-01-02" },
    ];
    const ids = inputs.map((input) => remember(store, {
      ...input,
      source: "sample",
      confidence: 0.9,
    }, config)).map((result) => result.id);
    return { ok: true, seeded: ids.length, facts: ids };
  } finally {
    store.close();
  }
}

export function removeSampleFacts(home) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) return { ok: true, removed: 0 };
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
    const kept = fs.readFileSync(queue, "utf8").split("\n").filter((line) => {
      if (line.trim() === "") return false;
      try {
        return !String(JSON.parse(line).pair_id ?? "").split(":").some((id) => ids.has(id));
      } catch {
        return true;
      }
    });
    const tmp = `${queue}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, kept.length === 0 ? "" : `${kept.join("\n")}\n`, "utf8");
    fs.renameSync(tmp, queue);
  }
  return { ok: true, removed };
}
