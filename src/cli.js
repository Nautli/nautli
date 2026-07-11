#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { remember } from "./core/gate.js";
import { recall } from "./core/recall.js";
import { ERR } from "./core/schema.js";
import { Store } from "./core/store.js";

const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
});

const ERROR_CODES = new Set(Object.values(ERR));

function homePath() {
  return path.resolve(process.env.NIGHTMERGE_HOME ?? path.join(os.homedir(), ".nightmerge"));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorPayload(error) {
  const code = ERROR_CODES.has(error?.code) ? error.code : ERR.E_INVALID_INPUT;
  return {
    error: code,
    message: error instanceof Error ? error.message : String(error),
  };
}

function readConfig(home) {
  const file = path.join(home, "config.json");
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

function parseCommand(args, options = {}) {
  return parseArgs({ args, options, allowPositionals: true, strict: true });
}

function requirePositionals(positionals, count) {
  if (positionals.length !== count) throw codedError(ERR.E_INVALID_INPUT);
}

function parseBudget(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw codedError(ERR.E_INVALID_INPUT);
  const budget = Number(value);
  if (!Number.isSafeInteger(budget)) throw codedError(ERR.E_INVALID_INPUT);
  return budget;
}

function initialize(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);
  fs.mkdirSync(home, { recursive: true });

  const store = new Store(home);
  store.close();

  const configFile = path.join(home, "config.json");
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, `${JSON.stringify(DEFAULT_CONFIG)}\n`, "utf8");
  }

  return { status: "initialized", home, config: readConfig(home) };
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

function doctor(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);

  const homeExists = fs.existsSync(home) && fs.statSync(home).isDirectory();
  const indexFile = path.join(home, "index.sqlite");
  const indexExists = homeExists && fs.existsSync(indexFile);
  if (!homeExists) {
    return {
      result: {
        ok: false,
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

async function runDaemon(home, args) {
  const parsed = parseCommand(args, {
    dry: { type: "boolean", default: false },
  });
  requirePositionals(parsed.positionals, 0);

  const moduleUrl = new URL("./daemon/pipeline.js", import.meta.url);
  if (!fs.existsSync(fileURLToPath(moduleUrl))) {
    return { missing: true, result: { error: "daemon not built" } };
  }

  const { runOnce } = await import(moduleUrl.href);
  const store = new Store(home);
  try {
    const result = await runOnce(store, home, readConfig(home), { dry: parsed.values.dry });
    return { missing: false, result };
  } finally {
    store.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...args] = argv;
    const home = homePath();

    if (command === "init") {
      writeJson(initialize(home, args));
      process.exitCode = 0;
      return;
    }

    if (command === "doctor") {
      const result = doctor(home, args);
      writeJson(result.result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === "mcp") {
      const parsed = parseCommand(args);
      requirePositionals(parsed.positionals, 0);
      const { startServer } = await import("./mcp/server.js");
      await startServer(home);
      process.exitCode = 0;
      return;
    }

    if (command === "daemon-run") {
      const result = await runDaemon(home, args);
      writeJson(result.result);
      process.exitCode = result.missing ? 1 : 0;
      return;
    }

    const store = new Store(home);
    try {
      if (command === "remember") {
        const parsed = parseCommand(args, {
          scope: { type: "string" },
          type: { type: "string" },
          supersedes: { type: "string" },
        });
        requirePositionals(parsed.positionals, 1);
        const result = remember(store, {
          claim: parsed.positionals[0],
          scope: parsed.values.scope,
          type: parsed.values.type,
          supersedes: parsed.values.supersedes,
        }, readConfig(home));
        writeJson(result);
        process.exitCode = result.status === "rejected" ? 2 : 0;
        return;
      }

      if (command === "recall") {
        const parsed = parseCommand(args, {
          budget: { type: "string" },
          scope: { type: "string" },
          "as-of": { type: "string" },
        });
        requirePositionals(parsed.positionals, 1);
        const budget = parseBudget(parsed.values.budget);
        const options = {
          scope: parsed.values.scope,
          as_of: parsed.values["as-of"],
        };
        if (budget !== undefined) options.budget_tokens = budget;
        writeJson(recall(store, parsed.positionals[0], options));
        process.exitCode = 0;
        return;
      }

      if (command === "rebuild") {
        const parsed = parseCommand(args);
        requirePositionals(parsed.positionals, 0);
        writeJson(store.rebuild());
        process.exitCode = 0;
        return;
      }

      if (command === "stats") {
        const parsed = parseCommand(args);
        requirePositionals(parsed.positionals, 0);
        writeJson(store.stats());
        process.exitCode = 0;
        return;
      }

      throw codedError(ERR.E_INVALID_INPUT, `Unknown command: ${command ?? ""}`);
    } finally {
      store.close();
    }
  } catch (error) {
    writeJson(errorPayload(error));
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) await main();
