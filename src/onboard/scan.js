import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { STATUS } from "../core/schema.js";
import { Store } from "../core/store.js";
import { checkClaudeStatus } from "./setup.js";

export const SCAN_VERSION = 1;
const COMMAND_TIMEOUT_MS = 2_000;
const SCAN_BUDGET_MS = 5_000;
const SESSION_FILE_CAP = 3_000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

function text(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
      ...options,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(text(stdout));
    });
  });
}

async function runText(runner, command, args) {
  if (!runner) return execFileText(command, args);
  return text(await runner(command, args, {
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  }));
}

async function simpleAgent(name, runner) {
  try {
    await runText(runner, name, ["--version"]);
    return { name, installed: true, connected: null };
  } catch {
    return { name, installed: false, connected: null };
  }
}

async function claudeAgent(runner) {
  const status = await checkClaudeStatus(runner).catch(() => ({
    cli_exists: false,
    registered: false,
  }));
  return {
    name: "claude",
    installed: status.cli_exists === true,
    connected: status.registered === true,
  };
}

async function codexAgent(runner) {
  try {
    await runText(runner, "codex", ["--version"]);
  } catch {
    return { name: "codex", installed: false, connected: false };
  }
  try {
    const list = await runText(runner, "codex", ["mcp", "list"]);
    return {
      name: "codex",
      installed: true,
      connected: /(^|\s)nautli(?:\s|:|$)/mu.test(list),
    };
  } catch {
    return { name: "codex", installed: true, connected: false };
  }
}

export async function detectAgents({ runner } = {}) {
  return Promise.all([
    claudeAgent(runner),
    codexAgent(runner),
    simpleAgent("cursor", runner),
    simpleAgent("gemini", runner),
  ]);
}

async function scanRoot(root, state, key) {
  if (state.clock() - state.startedAt >= state.budgetMs) {
    state.partial = true;
    return;
  }
  try {
    const rootMetadata = await fs.promises.lstat(root);
    if (state.clock() - state.startedAt >= state.budgetMs) {
      state.partial = true;
      return;
    }
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) return;
  } catch {
    if (state.clock() - state.startedAt >= state.budgetMs) state.partial = true;
    return;
  }
  const stack = [root];
  while (stack.length > 0 && !state.partial && !state.capped) {
    if (state.clock() - state.startedAt >= state.budgetMs) {
      state.partial = true;
      break;
    }
    const directory = stack.pop();
    let names;
    try {
      names = await fs.promises.readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (state.clock() - state.startedAt >= state.budgetMs) {
        state.partial = true;
        break;
      }
      const target = path.join(directory, name);
      let metadata;
      try {
        metadata = await fs.promises.lstat(target);
      } catch {
        continue;
      }
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!metadata.isFile() || path.extname(name).toLowerCase() !== ".jsonl") continue;
      if (state.filesSeen >= state.maxFiles) {
        state.capped = true;
        break;
      }
      state.filesSeen += 1;
      if (metadata.mtimeMs >= state.recentSince) state[key] += 1;
    }
  }
}

export async function scanUsage({
  userHome = os.homedir(),
  clock = Date.now,
  budgetMs = SCAN_BUDGET_MS,
  maxFiles = SESSION_FILE_CAP,
} = {}) {
  const startedAt = clock();
  const state = {
    budgetMs,
    capped: false,
    claude_sessions30d: 0,
    clock,
    codex_sessions30d: 0,
    filesSeen: 0,
    maxFiles,
    partial: false,
    recentSince: startedAt - THIRTY_DAYS_MS,
    startedAt,
  };
  await scanRoot(path.join(userHome, ".claude", "projects"), state, "claude_sessions30d");
  if (!state.partial && !state.capped) {
    await scanRoot(path.join(userHome, ".codex", "sessions"), state, "codex_sessions30d");
  }
  return {
    claude_sessions30d: state.claude_sessions30d,
    codex_sessions30d: state.codex_sessions30d,
    capped: state.capped,
    partial: state.partial,
  };
}

export function rememberedCount(home) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) return 0;
  const store = new Store(home);
  try {
    return store.stats().byStatus[STATUS.ACTIVE] ?? 0;
  } finally {
    store.close();
  }
}

export function readScanCache(home) {
  const file = path.join(home, "scan.json");
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value?.version !== SCAN_VERSION) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeScanCache(home, value) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "scan.json");
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const cache = { ...value, version: SCAN_VERSION };
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(cache)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return cache;
}
