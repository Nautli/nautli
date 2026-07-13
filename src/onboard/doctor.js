import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Store } from "../core/store.js";
import { statusAll } from "./setup.js";

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

export function doctor(home, { setup: suppliedSetup } = {}) {
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
    const store = new Store(home);
    try {
      sqliteIntegrity = store.db.pragma("integrity_check", { simple: true }) === "ok";
      indexCount = store.stats().total;
    } finally {
      store.close();
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
