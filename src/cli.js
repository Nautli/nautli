#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { remember } from "./core/gate.js";
import { recall } from "./core/recall.js";
import { applyCard, listCards } from "./core/review.js";
import { ERR } from "./core/schema.js";
import { Store } from "./core/store.js";
import { doctor } from "./onboard/doctor.js";
import {
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
} from "./onboard/setup.js";

const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
});

const ERROR_CODES = new Set(Object.values(ERR));

const USAGE = `nautli - 모든 AI가 공유하는 하나의 뇌

dashboard  설정과 기억을 관리하는 대시보드를 열어요.
init       기억 저장소를 초기화해요.
setup      AI 연결과 밤 소화를 설정해요.
remember   새 기억을 저장해요.
recall     저장된 기억을 검색해요.
daemon-run 밤 소화를 한 번 실행해요.
rebuild    기억 저장소 인덱스를 다시 만들어요.
stats      기억 저장소 통계를 보여줘요.
doctor     설치와 저장소 상태를 점검해요.
review     검토가 필요한 카드를 처리해요.
mcp        MCP 서버를 실행해요.

처음이면: node src/cli.js dashboard`;

function homePath() {
  return path.resolve(process.env.NAUTLI_HOME ?? path.join(os.homedir(), ".nautli"));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeUsage() {
  process.stdout.write(`${USAGE}\n`);
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

function doctorCommand(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);
  return doctor(home);
}

function dashboardPort(value) {
  if (value === undefined) return 4600;
  if (!/^\d+$/u.test(value)) throw codedError(ERR.E_INVALID_INPUT, "Invalid dashboard port");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw codedError(ERR.E_INVALID_INPUT, "Invalid dashboard port");
  }
  return port;
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

  const result = await runDigestOnce(home, { dry: parsed.values.dry });
  return { missing: false, result };
}

async function setupCommand(home, args) {
  const parsed = parseCommand(args, {
    yes: { type: "boolean", default: false },
    step: { type: "string" },
  });
  requirePositionals(parsed.positionals, 0);

  const runStep = async (name) => {
    if (name === "status") return statusAll(home);
    if (name === "init") return initStore(home);
    if (name === "mcp" || name === "register-mcp") return registerMcp(home);
    if (name === "instructions") return installInstructions(home);
    if (name === "instructions-preview") return installInstructions(home, { previewOnly: true });
    if (name === "remove-instructions") return removeInstructions(home);
    if (name === "daemon") return installDaemon(home);
    if (name === "uninstall-daemon") return uninstallDaemon(home);
    if (name === "digest") return runDigestOnce(home);
    if (name === "sample") return seedSampleFacts(home);
    if (name === "remove-sample") return removeSampleFacts(home);
    throw codedError(ERR.E_INVALID_INPUT, `Unknown setup step: ${name}`);
  };

  if (parsed.values.step !== undefined) return runStep(parsed.values.step);
  if (!parsed.values.yes) return statusAll(home);

  const results = [];
  results.push({ step: "init", result: await runStep("init") });
  results.push({ step: "mcp", result: await runStep("mcp") });
  results.push({ step: "instructions", result: await runStep("instructions") });
  results.push({ step: "daemon", result: await runStep("daemon") });
  results.push({ step: "digest", result: await runStep("digest") });
  return { ok: true, results, status: statusAll(home) };
}

async function reviewCommand(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);
  const cards = listCards(home);
  if (cards.length === 0) return { ok: true, reviewed: 0, message: "검토할 카드가 없어요. 다음 소화는 오늘 새벽 3:30." };

  const store = new Store(home);
  const input = createInterface({ input: process.stdin, output: process.stderr });
  let reviewed = 0;
  try {
    for (const card of cards) {
      process.stderr.write(`\n[${card.verdict === "duplicate" ? "중복 정리" : "모순 발견"}] ${card.confidence ?? "?"}\n`);
      process.stderr.write(`A: ${card.claims?.a ?? ""}\nB: ${card.claims?.b ?? ""}\n`);
      let answer;
      if (card.verdict === "duplicate") {
        answer = (await input.question("[O] 합치기 / [X] 따로 유지 / [L] 내일 다시 보기: ")).trim();
        const action = /^o$/iu.test(answer) ? "merge" : /^x$/iu.test(answer) ? "keep_separate" : "defer";
        applyCard(store, home, card.pair_id, action);
      } else {
        answer = (await input.question("[O] 새 기억 / [X] 옛 기억 / [B] 둘 다 / 기타 정정문: ")).trim();
        if (/^o$/iu.test(answer)) applyCard(store, home, card.pair_id, "newer_wins");
        else if (/^x$/iu.test(answer)) applyCard(store, home, card.pair_id, "older_wins");
        else if (/^b$/iu.test(answer)) applyCard(store, home, card.pair_id, "both_valid");
        else applyCard(store, home, card.pair_id, "other", answer);
      }
      reviewed += 1;
    }
  } finally {
    input.close();
    store.close();
  }
  return { ok: true, reviewed };
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...args] = argv;
    const home = homePath();

    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      writeUsage();
      process.exitCode = 0;
      return;
    }

    if (command === "init") {
      writeJson(initialize(home, args));
      process.stderr.write("다음 단계: node src/cli.js dashboard (설정 화면이 열려요)\n");
      process.exitCode = 0;
      return;
    }

    if (command === "doctor") {
      const result = doctorCommand(home, args);
      writeJson(result.result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === "setup") {
      writeJson(await setupCommand(home, args));
      process.exitCode = 0;
      return;
    }

    if (command === "review") {
      writeJson(await reviewCommand(home, args));
      process.exitCode = 0;
      return;
    }

    if (command === "dashboard") {
      const parsed = parseCommand(args, {
        port: { type: "string" },
        "no-open": { type: "boolean", default: false },
      });
      requirePositionals(parsed.positionals, 0);
      const { startDashboard } = await import("./dashboard/server.js");
      const dashboard = await startDashboard(home, {
        port: dashboardPort(parsed.values.port),
        open: !parsed.values["no-open"],
      });
      process.stdout.write(`Dashboard: ${dashboard.url}\n`);
      process.exitCode = 0;
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
      process.exitCode = result.missing || result.result?.ok === false ? 1 : 0;
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
