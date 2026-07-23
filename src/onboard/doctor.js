import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "../core/store.js";
import { statusAll } from "./setup.js";

// TASK-114: npm 12이 better-sqlite3의 install script를 차단한 경우의 복구 안내.
const NPM12_INSTALL_SCRIPT_COMMAND = "npm install-scripts approve --all --allow-scripts-pin";
const BETTER_SQLITE3_REBUILD_COMMAND = "npm rebuild better-sqlite3 --foreground-scripts";
const NPM12_NATIVE_BUILD_REFERENCE = "https://github.com/Nautli/nautli/blob/main/docs/research/npm12-native-build.md";

export function isBetterSqlite3BindingsError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Could not locate the bindings file/u.test(message)
    && /better_sqlite3\.node/u.test(message);
}

export function npm12NativeBuildGuidance({ short = false } = {}) {
  const prefix = short
    ? "better-sqlite3 native bindings are missing; npm 12 may have blocked its install script."
    : "better-sqlite3 native bindings are missing. npm 12 may have blocked its install script.";
  return `${prefix} From the installation root run: ${NPM12_INSTALL_SCRIPT_COMMAND}; `
    + `${BETTER_SQLITE3_REBUILD_COMMAND}. See ${NPM12_NATIVE_BUILD_REFERENCE}.`;
}

export function checkCommand(command, args, runner = spawnSync) {
  try {
    const result = runner(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result && typeof result === "object") {
      return !result.error && (result.status === undefined || result.status === 0);
    }
    return true;
  } catch {
    return false;
  }
}

export function checkClaudeLogin(runner = spawnSync) {
  const cliExists = checkCommand("claude", ["--version"], runner);
  return {
    cli_exists: cliExists,
    logged_in: cliExists && checkCommand("claude", ["auth", "status"], runner),
  };
}

function countAddedEvents(home) {
  const directory = path.join(home, "events");
  if (!fs.existsSync(directory)) return 0;

  let count = 0;
  const files = fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file))
    .sort();
  for (const file of files) {
    const lines = fs.readFileSync(path.join(directory, file), "utf8").split("\n");
    for (const line of lines) {
      if (line.trim() !== "" && JSON.parse(line).ev === "fact.added") count += 1;
    }
  }
  return count;
}

export function doctor(home, { setup: suppliedSetup, Store: StoreClass = Store } = {}) {
  const homeExists = fs.existsSync(home) && fs.statSync(home).isDirectory();
  const indexFile = path.join(home, "index.sqlite");
  const indexExists = homeExists && fs.existsSync(indexFile);
  const setup = suppliedSetup ?? statusAll(home);
  if (!homeExists) {
    return {
      result: {
        ok: false,
        node_version: process.versions.node,
        claude_cli: setup.required.mcp.cli_exists,
        claude_mcp_registered: setup.required.mcp.registered,
        daemon: setup.required.daemon,
        home_exists: false,
        index_exists: false,
        sqlite_integrity: false,
        event_count: 0,
        index_count: 0,
        counts_match: false,
      },
      ok: false,
    };
  }

  const eventCount = countAddedEvents(home);
  let sqliteIntegrity = false;
  let indexCount = 0;
  if (indexExists) {
    let store;
    try {
      store = new StoreClass(home);
      sqliteIntegrity = store.db.pragma("integrity_check", { simple: true }) === "ok";
      indexCount = store.stats().total;
    } catch (error) {
      if (!isBetterSqlite3BindingsError(error)) throw error;
      return {
        result: {
          ok: false,
          node_version: process.versions.node,
          claude_cli: setup.required.mcp.cli_exists,
          claude_mcp_registered: setup.required.mcp.registered,
          daemon: setup.required.daemon,
          home_exists: true,
          index_exists: true,
          sqlite_integrity: false,
          event_count: eventCount,
          index_count: 0,
          counts_match: false,
          // TASK-114: npm 12 install-script 차단의 실측 복구 경로를 CLI JSON에 노출한다.
          npm12_native_build: {
            suspected: true,
            guidance: npm12NativeBuildGuidance(),
            commands: [NPM12_INSTALL_SCRIPT_COMMAND, BETTER_SQLITE3_REBUILD_COMMAND],
            reference: NPM12_NATIVE_BUILD_REFERENCE,
          },
        },
        ok: false,
      };
    } finally {
      store?.close();
    }
  }

  const countsMatch = eventCount === indexCount;
  const ok = indexExists && sqliteIntegrity && countsMatch;
  return {
    result: {
      ok,
      node_version: process.versions.node,
      claude_cli: setup.required.mcp.cli_exists,
      claude_mcp_registered: setup.required.mcp.registered,
      daemon: setup.required.daemon,
      home_exists: true,
      index_exists: indexExists,
      sqlite_integrity: sqliteIntegrity,
      event_count: eventCount,
      index_count: indexCount,
      counts_match: countsMatch,
    },
    ok,
  };
}
