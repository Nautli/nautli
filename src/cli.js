#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import {
  isProjectOptedIn,
  listOptedProjects,
  setProjectOptIn,
} from "./capture/consent.js";
import {
  captureHookStatus,
  installCaptureHook,
  uninstallCaptureHook,
} from "./capture/hooks.js";
import { drainOnce } from "./capture/drain.js";
import {
  MIN_DECIDED,
  MIN_RECALL,
  captureMetrics,
} from "./capture/metrics.js";
import { writeSpoolEntry } from "./capture/spool.js";
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
const CAPTURE_HOOK_STDIN_LIMIT = 16 * 1024;

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
capture    프로젝트 자동 캡처 동의와 계측을 관리해요.
           지표 보기: nautli capture metrics [--json]
purge      기억을 완전히 삭제해요.
mcp        MCP 서버를 실행해요.

처음이면: npx nautli dashboard`;

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

function captureHooksCommand(args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 1);
  const [action] = parsed.positionals;
  const options = { userHome: os.homedir() };

  if (action === "install") return installCaptureHook(options);
  if (action === "uninstall") return uninstallCaptureHook(options);
  if (action === "status") return captureHookStatus(options);
  throw codedError(ERR.E_INVALID_INPUT);
}

function commandArgv(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)
      && parsed.length > 0
      && parsed.every((part) => typeof part === "string")) return parsed;
  } catch {
    // JSON 배열이 아니면 따옴표를 지원하는 단순 argv 문자열로 해석한다.
  }
  const argv = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/gu;
  for (const match of value.matchAll(pattern)) {
    argv.push(match[1] === undefined
      ? match[2] === undefined ? match[3] : match[2]
      : match[1].replace(/\\([\\"])/gu, "$1"));
  }
  return argv.length > 0 ? argv : null;
}

async function captureDrainCommand(home, args) {
  const parsed = parseCommand(args, {
    dry: { type: "boolean", default: false },
  });
  requirePositionals(parsed.positionals, 0);

  const config = readConfig(home);
  const override = commandArgv(process.env.NAUTLI_EXTRACT_CMD);
  if (override) config.judge_cmd = override;
  return drainOnce(home, config, { dry: parsed.values.dry });
}

function formatRate(value) {
  return value === null ? "측정 전" : `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value) {
  if (value === null) return "측정 전";
  if (value < 1000) return `${value.toFixed(0)}ms`;
  return `${(value / 1000).toFixed(1)}초`;
}

function formatRefs(value) {
  return value === null || value === undefined ? "측정 전" : value.toFixed(2);
}

function renderCaptureMetrics(report) {
  const badge = report.verdict === "PASS"
    ? "[통과]"
    : report.verdict === "KILL" ? "[중단 권고]" : "[표본 부족]";
  const { auto, explicit } = report.metrics;
  const lines = [
    `${badge} 자동 캡처 계측 · ${report.sample.window_days}일`,
    "",
    "지표                  자동 캡처        직접 저장",
    `승인율                ${formatRate(auto.approval_rate)}`,
    `오탐률                ${formatRate(auto.false_positive_rate)}`,
    `검토시간 중앙값       ${formatLatency(auto.median_review_latency_ms)}`,
    `유용 회상률           ${formatRate(auto.useful_recall_rate).padEnd(17)}${formatRate(explicit.useful_recall_rate)}`,
    `fact당 회상 참조      ${formatRefs(auto.recall_refs_per_fact).padEnd(17)}${formatRefs(explicit.recall_refs_per_fact)}`,
    "",
    `표본                  후보 ${auto.candidates} · 결정 ${report.sample.decided_cards}/${MIN_DECIDED} · 회상 ${report.sample.recall_events}/${MIN_RECALL}`,
    `fact                  자동 ${report.sample.auto_facts} · 직접 ${report.sample.explicit_facts} · 세션 ${report.sample.capture_sessions}`,
  ];
  if (report.verdict === "INSUFFICIENT_SAMPLE") {
    // 판정 게이트는 날짜가 아니라 결정·회상 카운트다. 남은 건 '며칠'이 아니라 '몇 건'.
    const needDecided = Math.max(0, MIN_DECIDED - report.sample.decided_cards);
    const needRecall = Math.max(0, MIN_RECALL - report.sample.recall_events);
    lines.push(
      "",
      `아직 판정할 수 없어요. 카드 결정 ${needDecided}건·회상 ${needRecall}건을 더 채우면 판정합니다.`,
    );
  } else {
    lines.push("", report.verdict_reason);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function captureMetricsCommand(home, args) {
  const parsed = parseCommand(args, {
    json: { type: "boolean", default: false },
  });
  requirePositionals(parsed.positionals, 0);
  const report = captureMetrics(home);
  if (parsed.values.json) return report;
  renderCaptureMetrics(report);
  return undefined;
}

async function captureCommand(home, args) {
  const [action, ...rest] = args;

  if (action === "hooks") return captureHooksCommand(rest);
  if (action === "drain") return captureDrainCommand(home, rest);
  if (action === "metrics") return captureMetricsCommand(home, rest);

  const parsed = parseCommand(args);
  const [consentAction, ...projectPaths] = parsed.positionals;
  if (consentAction === "status") {
    requirePositionals(projectPaths, 0);
    return { projects: listOptedProjects(home) };
  }
  if (consentAction !== "on" && consentAction !== "off") {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  if (projectPaths.length > 1) throw codedError(ERR.E_INVALID_INPUT);
  return setProjectOptIn(
    home,
    projectPaths[0] ?? process.cwd(),
    consentAction === "on",
  );
}

async function readCaptureHookInput() {
  const chunks = [];
  let length = 0;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > CAPTURE_HOOK_STDIN_LIMIT) {
      process.stdin.destroy();
      return null;
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, length).toString("utf8");
}

async function captureHookCommand(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);

  const input = await readCaptureHookInput();
  if (input === null) return;
  const payload = JSON.parse(input);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Invalid capture hook payload");
  }

  const { session_id: sessionId, transcript_path: transcriptPath, cwd } = payload;
  if ([sessionId, transcriptPath, cwd]
    .some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("Invalid capture hook payload");
  }

  if (!isProjectOptedIn(home, cwd)) return;

  writeSpoolEntry(home, {
    session_id: sessionId,
    transcript_path: transcriptPath,
    project: fs.realpathSync(path.resolve(cwd)),
    at: new Date().toISOString(),
    kind: "stop",
  });
}

function claimPreview(claim) {
  return [...claim].slice(0, 40).join("");
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

    if (command === "capture-hook") {
      try {
        await captureHookCommand(home, args);
      } catch (error) {
        process.stderr.write(
          `capture-hook: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      process.exitCode = 0;
      return;
    }

    if (command === "init") {
      writeJson(initialize(home, args));
      process.stderr.write("다음 단계: npx nautli dashboard (설정 화면이 열려요)\n");
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

    if (command === "capture") {
      const result = await captureCommand(home, args);
      if (result !== undefined) writeJson(result);
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
          source: "cli",
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
          source: "cli",
        };
        if (budget !== undefined) options.budget_tokens = budget;
        writeJson(recall(store, parsed.positionals[0], options));
        process.exitCode = 0;
        return;
      }

      if (command === "purge") {
        const parsed = parseCommand(args, {
          yes: { type: "boolean", default: false },
        });
        if (parsed.positionals.length === 0) throw codedError(ERR.E_INVALID_INPUT);
        const facts = parsed.positionals.map((id) => {
          const fact = store.getFact(id);
          if (!fact) throw codedError(ERR.E_NOT_FOUND);
          return fact;
        });
        if (!parsed.values.yes) {
          writeJson({
            facts: facts.map((fact) => ({
              id: fact.id,
              claim: claimPreview(fact.claim),
            })),
          });
          process.exitCode = 0;
          return;
        }
        writeJson(store.purge(facts.map((fact) => fact.id), { source: "cli" }));
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
  && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;

if (isMain) await main();
