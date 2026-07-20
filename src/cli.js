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
import {
  DEFAULT_PATROL,
  consumeSpool,
  readSpool,
} from "./core/spool.js";
import { Store } from "./core/store.js";
import { isTelemetryEnabled } from "./daemon/telemetry.js";
import { makeT, resolveLocale } from "./i18n/strings.js";
import {
  checkupStatus,
  startCheckup,
  TASTE,
  validateVaultPath,
} from "./onboard/checkup.js";
import { checkClaudeLogin, doctor } from "./onboard/doctor.js";
import {
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
  checkAndEscalate,
  seedSampleFacts,
  statusAll,
  uninstallApp,
  uninstallDaemon,
} from "./onboard/setup.js";

const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
  patrol: DEFAULT_PATROL,
});

const ERROR_CODES = new Set(Object.values(ERR));
const CAPTURE_HOOK_STDIN_LIMIT = 16 * 1024;
const locale = resolveLocale();
const t = makeT(locale);

function homePath() {
  return path.resolve(process.env.NAUTLI_HOME ?? path.join(os.homedir(), ".nautli"));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeUsage() {
  process.stdout.write(`${t("cli.usage")}\n`);
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorPayload(error) {
  const code = ERROR_CODES.has(error?.code) ? error.code : ERR.E_INVALID_INPUT;
  const rawMessage = error instanceof Error ? error.message : String(error);
  return {
    error: code,
    message: rawMessage === code ? t("cli.error.invalid_input") : rawMessage,
  };
}

function readConfig(home) {
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

function writeConfig(home, config) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "config.json");
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(config)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
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

  const result = initStore(home);
  if (result.first_install) {
    process.stderr.write(t("telemetry.first_run_notice") + "\n");
  }

  return { status: "initialized", home, config: readConfig(home) };
}

function doctorCommand(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);
  return doctor(home);
}

async function scanCommand(args) {
  const parsed = parseCommand(args, {
    json: { type: "boolean", default: false },
    "no-open": { type: "boolean", default: false },
    "no-ping": { type: "boolean", default: false },
    lang: { type: "string" },
  });
  requirePositionals(parsed.positionals, 0);
  const lang = parsed.values.lang ?? locale;
  if (lang !== "en" && lang !== "ko" && lang !== "ja") throw codedError(ERR.E_INVALID_INPUT);

  const { runScan } = await import("./scan/index.js");
  const scan = await runScan({
    lang,
    noOpen: parsed.values["no-open"],
    noPing: parsed.values["no-ping"],
  });
  if (parsed.values.json) {
    writeJson(scan.result);
    return;
  }

  const scanT = makeT(lang);
  process.stdout.write(`${scanT("cli.scan.score", {
    score: scan.result.score,
    grade: scan.result.grade,
  })}\n`);
  process.stdout.write(`${scanT("cli.scan.tools", { count: scan.result.tools.length })}\n`);
  process.stdout.write(`${scanT("cli.scan.top", {
    finding: scan.result.findings[0]?.title ?? scanT("cli.scan.clean"),
  })}\n`);
  process.stdout.write(`${scanT("cli.scan.report", { file: scan.reportFile })}\n`);
  process.stdout.write(`${scanT(`cli.scan.privacy_${scan.pingStatus}`)}\n`);
}

function telemetryCommand(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 1);
  const [action] = parsed.positionals;
  const config = readConfig(home);
  const telemetry = config.telemetry && typeof config.telemetry === "object"
    && !Array.isArray(config.telemetry)
    ? config.telemetry
    : {};

  if (action === "on" || action === "off") {
    writeConfig(home, {
      ...config,
      telemetry: { ...telemetry, enabled: action === "on" },
    });
    if (action === "on") {
      process.stdout.write("판정 메타 선택 수집을 켰습니다.\n");
      process.stdout.write("노트나 기억의 내용은 절대 보내지 않아요. 카드 개수와 판정 결과 통계만 보냅니다.\n");
      process.stdout.write("함께 보내는 정보는 무작위 설치 식별자, 앱 버전, 운영체제 종류입니다.\n");
      process.stdout.write("프로젝트 이름과 경로, 신고 내용도 보내지 않습니다.\n");
    } else {
      process.stdout.write("판정 메타 선택 수집을 껐습니다. 이제 아무것도 보내지 않습니다.\n");
    }
    return;
  }

  if (action === "status") {
    process.stdout.write(`판정 메타 선택 수집: ${isTelemetryEnabled(config) ? "켜짐" : "꺼짐"}\n`);
    process.stdout.write(`마지막 전송 시각: ${typeof telemetry.last_sent_at === "string" ? telemetry.last_sent_at : "없음"}\n`);
    process.stdout.write("보내는 항목: 무작위 설치 식별자, 앱 버전, 운영체제 종류, 카드 종류별 개수, 라우팅과 판정 결과, 확신도 구간, 사용자 행동 개수, 대기 카드와 기억의 범위별 개수\n");
    process.stdout.write("보내지 않는 항목: 노트와 기억 내용, 프로젝트 이름과 경로, 신고 내용\n");
    return;
  }

  throw codedError(ERR.E_INVALID_INPUT);
}

async function checkupCommand(home, args) {
  const parsed = parseCommand(args, {
    status: { type: "boolean", default: false },
  });
  if (parsed.values.status) {
    requirePositionals(parsed.positionals, 0);
    writeJson(checkupStatus(home));
    return 0;
  }

  requirePositionals(parsed.positionals, 1);
  const [vaultPath] = parsed.positionals;
  const resolved = validateVaultPath(vaultPath, { home, locale });
  const current = checkupStatus(home);

  if (current.state === "running") {
    if (current.vault !== resolved) {
      const error = codedError(
        ERR.E_STORE_BUSY,
        t("cli.checkup.other_running", { vault: current.vault }),
      );
      process.stderr.write(`${error.message}\n`);
      throw error;
    }
    process.stderr.write(`${t("cli.checkup.already_running")}\n`);
  } else {
    const claude = checkClaudeLogin();
    if (!claude.cli_exists) {
      throw codedError(ERR.E_INVALID_INPUT, t("cli.checkup.claude_missing"));
    }
    if (!claude.logged_in) {
      throw codedError(ERR.E_INVALID_INPUT, t("cli.checkup.claude_login"));
    }

    try {
      const started = startCheckup(home, resolved, { locale });
      process.stderr.write(`${t("cli.checkup.started", {
        vault: started.vault,
        maxFiles: TASTE.maxFiles,
      })}\n`);
    } catch (error) {
      if (error?.code !== ERR.E_STORE_BUSY) throw error;
      process.stderr.write(`${t("cli.checkup.already_running")}\n`);
    }
  }

  const deadline = Date.now() + 90 * 60 * 1000;
  let previousProgress = null;
  while (Date.now() < deadline) {
    const status = checkupStatus(home);
    if (status.state === "done" || status.state === "imported") {
      writeJson({
        state: status.state,
        vault: status.vault,
        summary: status.summary,
        report_file: status.report_file,
      });
      process.stderr.write(`${t("cli.checkup.complete")}\n`);
      return 0;
    }
    if (status.state === "failed") {
      writeJson({ state: "failed", vault: status.vault, log_tail: status.log_tail });
      return 1;
    }
    if (status.state === "none" || status.state === "dismissed") {
      writeJson(status);
      return 1;
    }

    const progress = status.progress ?? {};
    const progressLine = progress.phase === "judge"
      ? t("cli.checkup.judge_progress", {
        done: progress.judge_done ?? 0,
        total: progress.judge_total ?? "?",
      })
      : t("cli.checkup.extract_progress", {
        done: progress.batches_done ?? 0,
        total: progress.batches_total ?? "?",
      });
    if (progressLine !== previousProgress) {
      process.stderr.write(`${progressLine}\n`);
      previousProgress = progressLine;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  writeJson({
    state: "timeout",
    hint: t("cli.checkup.timeout"),
  });
  return 1;
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
  return value === null ? t("cli.metrics.not_measured") : `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value) {
  if (value === null) return t("cli.metrics.not_measured");
  if (value < 1000) return `${value.toFixed(0)}ms`;
  return t("cli.metrics.seconds", { value: (value / 1000).toFixed(1) });
}

function formatRefs(value) {
  return value === null || value === undefined
    ? t("cli.metrics.not_measured")
    : value.toFixed(2);
}

function renderCaptureMetrics(report) {
  const badge = report.verdict === "PASS"
    ? t("cli.metrics.badge_pass")
    : report.verdict === "KILL"
      ? t("cli.metrics.badge_kill")
      : t("cli.metrics.badge_insufficient");
  const { auto, explicit } = report.metrics;
  const lines = [
    t("cli.metrics.title", { badge, days: report.sample.window_days }),
    "",
    t("cli.metrics.header"),
    t("cli.metrics.approval", { value: formatRate(auto.approval_rate) }),
    t("cli.metrics.false_positive", { value: formatRate(auto.false_positive_rate) }),
    t("cli.metrics.review_latency", { value: formatLatency(auto.median_review_latency_ms) }),
    t("cli.metrics.useful_recall", {
      auto: formatRate(auto.useful_recall_rate).padEnd(17),
      explicit: formatRate(explicit.useful_recall_rate),
    }),
    t("cli.metrics.recall_refs", {
      auto: formatRefs(auto.recall_refs_per_fact).padEnd(17),
      explicit: formatRefs(explicit.recall_refs_per_fact),
    }),
    "",
    t("cli.metrics.sample", {
      candidates: auto.candidates,
      decided: report.sample.decided_cards,
      minDecided: MIN_DECIDED,
      recalls: report.sample.recall_events,
      minRecall: MIN_RECALL,
    }),
    t("cli.metrics.facts", {
      auto: report.sample.auto_facts,
      explicit: report.sample.explicit_facts,
      sessions: report.sample.capture_sessions,
    }),
  ];
  if (report.verdict === "INSUFFICIENT_SAMPLE") {
    // 판정 게이트는 날짜가 아니라 결정·회상 카운트다. 남은 건 '며칠'이 아니라 '몇 건'.
    const needDecided = Math.max(0, MIN_DECIDED - report.sample.decided_cards);
    const needRecall = Math.max(0, MIN_RECALL - report.sample.recall_events);
    lines.push(
      "",
      t("cli.metrics.need_more", { decided: needDecided, recalls: needRecall }),
    );
  } else {
    lines.push(
      "",
      locale === "ko"
        ? t("cli.metrics.raw_reason", { reason: report.verdict_reason })
        : t(report.verdict === "PASS"
          ? "cli.metrics.pass_reason"
          : "cli.metrics.kill_reason"),
    );
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
    throw new TypeError(t("cli.capture.invalid_payload"));
  }

  const { session_id: sessionId, transcript_path: transcriptPath, cwd } = payload;
  if ([sessionId, transcriptPath, cwd]
    .some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError(t("cli.capture.invalid_payload"));
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

async function sessionStartHookCommand(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);

  const input = await readCaptureHookInput();
  if (input === null) return;
  const payload = JSON.parse(input);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;

  const { session_id: sessionId, cwd } = payload;
  if (typeof sessionId !== "string" || sessionId.length === 0) return;

  const { buildSessionStartOutput } = await import("./session-start/index.js");
  const config = readConfig(home);
  const result = buildSessionStartOutput(home, { sessionId, cwd, config });

  if (result.injected && result.output) {
    process.stdout.write(result.output);
  }
}

function claimPreview(claim) {
  return [...claim].slice(0, 40).join("");
}

function dashboardPort(value) {
  if (value === undefined) return 4600;
  if (!/^\d+$/u.test(value)) throw codedError(ERR.E_INVALID_INPUT, t("cli.dashboard.invalid_port"));
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw codedError(ERR.E_INVALID_INPUT, t("cli.dashboard.invalid_port"));
  }
  return port;
}

function patrolTiming(config) {
  const value = config?.patrol && typeof config.patrol === "object" ? config.patrol : {};
  const nonnegative = (candidate, fallback) => (
    Number.isFinite(candidate) && candidate >= 0 ? candidate : fallback
  );
  return {
    settle_ms: nonnegative(value.settle_ms, DEFAULT_PATROL.settle_ms),
    max_wait_ms: nonnegative(value.max_wait_ms, DEFAULT_PATROL.max_wait_ms),
  };
}

async function dwellForSpool(home, config, {
  spoolReader,
  now,
  sleeper,
}) {
  const { settle_ms: settleMs, max_wait_ms: maxWaitMs } = patrolTiming(config);
  let waited = 0;
  while (waited < maxWaitMs) {
    const spool = spoolReader(home);
    if (spool.count === 0 || spool.newest_at === null) return;
    const remainingSettle = settleMs - (now() - spool.newest_at);
    if (remainingSettle <= 0) return;
    const delay = Math.min(20_000, remainingSettle, maxWaitMs - waited);
    if (delay <= 0) return;
    await sleeper(delay);
    waited += delay;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runDaemon(home, args, {
  configReader = readConfig,
  digestRunner = runDigestOnce,
  freshnessReader = digestFreshness,
  notifier = notifyDigestResult,
  skipRecorder = recordDigestSkip,
  spoolReader = readSpool,
  spoolConsumer = consumeSpool,
  now = Date.now,
  sleeper = defaultSleep,
} = {}) {
  const parsed = parseCommand(args, {
    dry: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  });
  requirePositionals(parsed.positionals, 0);

  const moduleUrl = new URL("./daemon/pipeline.js", import.meta.url);
  if (!fs.existsSync(fileURLToPath(moduleUrl))) {
    return { missing: true, result: { error: t("cli.daemon.not_built") } };
  }

  const initialSpool = spoolReader(home);
  const trigger = initialSpool.count > 0 ? "spool" : "patrol";
  const eventRun = trigger === "spool" && !parsed.values.dry && !parsed.values.force;

  // 스풀 이벤트가 없을 때만 2:00 정기 실행과 RunAtLoad의 catch-up 게이트를 적용한다.
  if (!parsed.values.dry && !parsed.values.force && initialSpool.count === 0) {
    const freshness = freshnessReader(home);
    if (freshness.fresh) {
      const reason = t("cli.daemon.skipped_fresh", { last: freshness.last_success_at });
      skipRecorder(home, reason, trigger);
      return {
        missing: false,
        result: {
          ok: true,
          skipped_run: true,
          trigger,
          reason,
          last_success_at: freshness.last_success_at,
        },
      };
    }
  }

  const config = configReader(home);
  // 이 프로세스(소화 데몬) 안에서 일어나는 내부 remember는 스풀을 재적재하지 않는다 — 자가 재발사 방지.
  const priorSuppress = process.env.NAUTLI_SUPPRESS_SPOOL;
  process.env.NAUTLI_SUPPRESS_SPOOL = "1";
  try {
    let result;
    for (let cycle = 0; cycle < (eventRun ? 3 : 1); cycle += 1) {
      if (eventRun) {
        await dwellForSpool(home, config, { spoolReader, now, sleeper });
      }

      // 디지스트 직전 스냅샷 — 소화 중 새로 생긴 marker는 다음 사이클이 처리한다.
      const snapshot = spoolReader(home);
      const digestResult = await digestRunner(home, {
        dry: parsed.values.dry,
        locale,
        trigger,
      });
      result = { ...digestResult, trigger };
      if (!parsed.values.dry) {
        notifier(result, { home, locale, config });
        if (!result.ok) checkAndEscalate(home);
      }

      const succeeded = result.ok === true && !result.skipped_run;
      if (eventRun && succeeded) spoolConsumer(home, snapshot.names ?? []);
      if (!eventRun || !succeeded || spoolReader(home).count === 0) break;
    }
    return { missing: false, result };
  } catch (error) {
    if (!parsed.values.dry) {
      notifier({ ok: false, trigger }, { home, locale, config });
      checkAndEscalate(home);
    }
    throw error;
  } finally {
    if (priorSuppress === undefined) delete process.env.NAUTLI_SUPPRESS_SPOOL;
    else process.env.NAUTLI_SUPPRESS_SPOOL = priorSuppress;
  }
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
    if (name === "mcp" || name === "register-mcp") return registerMcp(home, undefined, { locale });
    if (name === "instructions") return installInstructions(home, { locale });
    if (name === "instructions-preview") return installInstructions(home, { previewOnly: true, locale });
    if (name === "remove-instructions") return removeInstructions(home);
    if (name === "daemon") return installDaemon(home, undefined, { locale });
    if (name === "uninstall-daemon") return uninstallDaemon(home);
    if (name === "app") return installApp(home, undefined, { locale });
    if (name === "uninstall-app") return uninstallApp(home);
    if (name === "digest") return runDigestOnce(home, { locale });
    if (name === "sample") return seedSampleFacts(home);
    if (name === "remove-sample") return removeSampleFacts(home);
    throw codedError(ERR.E_INVALID_INPUT, t("cli.setup.unknown_step", { name }));
  };

  if (parsed.values.step !== undefined) return runStep(parsed.values.step);
  if (!parsed.values.yes) return statusAll(home);

  const results = [];
  results.push({ step: "init", result: await runStep("init") });
  results.push({ step: "mcp", result: await runStep("mcp") });
  results.push({ step: "instructions", result: await runStep("instructions") });
  results.push({ step: "daemon", result: await runStep("daemon") });
  results.push({ step: "app", result: await runStep("app") });
  results.push({ step: "digest", result: await runStep("digest") });
  return { ok: true, results, status: statusAll(home) };
}

async function reviewCommand(home, args) {
  const parsed = parseCommand(args);
  requirePositionals(parsed.positionals, 0);
  const cards = listCards(home);
  if (cards.length === 0) {
    return { ok: true, reviewed: 0, message: t("cli.review.empty") };
  }

  const store = new Store(home);
  const input = createInterface({ input: process.stdin, output: process.stderr });
  let reviewed = 0;
  try {
    for (const card of cards) {
      const label = card.verdict === "duplicate"
        ? t("cli.review.duplicate")
        : t("cli.review.contradiction");
      process.stderr.write(`\n[${label}] ${card.confidence ?? "?"}\n`);
      process.stderr.write(`A: ${card.claims?.a ?? ""}\nB: ${card.claims?.b ?? ""}\n`);
      let answer;
      if (card.verdict === "duplicate") {
        answer = (await input.question(t("cli.review.duplicate_prompt"))).trim();
        const action = /^o$/iu.test(answer) ? "merge" : /^x$/iu.test(answer) ? "keep_separate" : "defer";
        applyCard(store, home, card.pair_id, action);
      } else {
        answer = (await input.question(t("cli.review.contradiction_prompt"))).trim();
        if (/^a$/iu.test(answer)) applyCard(store, home, card.pair_id, "a_wins");
        else if (/^b$/iu.test(answer)) applyCard(store, home, card.pair_id, "b_wins");
        else if (/^o$/iu.test(answer)) applyCard(store, home, card.pair_id, "both_valid");
        else if (/^\?$/u.test(answer)) applyCard(store, home, card.pair_id, "unknown");
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

    if (command === "session-start-hook") {
      try {
        await sessionStartHookCommand(home, args);
      } catch (error) {
        process.stderr.write(
          `session-start-hook: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      process.exitCode = 0;
      return;
    }

    if (command === "session-start-judgment") {
      const { computeJudgment } = await import("./session-start/judgment.js");
      const parsed = parseCommand(args, { since: { type: "string" } });
      requirePositionals(parsed.positionals, 0);
      writeJson(computeJudgment(home, { since: parsed.values.since }));
      process.exitCode = 0;
      return;
    }

    if (command === "session-start") {
      const [action] = args;
      const {
        sessionStartHookStatus,
        installSessionStartHook,
        uninstallSessionStartHook,
      } = await import("./session-start/hooks.js");
      const options = { userHome: os.homedir() };
      if (action === "install") { writeJson(installSessionStartHook(options)); }
      else if (action === "uninstall") { writeJson(uninstallSessionStartHook(options)); }
      else if (action === "status") { writeJson(sessionStartHookStatus(options)); }
      else throw codedError(ERR.E_INVALID_INPUT);
      process.exitCode = 0;
      return;
    }

    if (command === "init") {
      writeJson(initialize(home, args));
      process.stderr.write(`${t("cli.init.next")}\n`);
      process.exitCode = 0;
      return;
    }

    if (command === "doctor") {
      const result = doctorCommand(home, args);
      writeJson(result.result);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === "telemetry") {
      telemetryCommand(home, args);
      process.exitCode = 0;
      return;
    }

    if (command === "scan") {
      await scanCommand(args);
      process.exitCode = 0;
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

    if (command === "checkup") {
      process.exitCode = await checkupCommand(home, args);
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

      throw codedError(
        ERR.E_INVALID_INPUT,
        t("cli.unknown_command", { command: command ?? "" }),
      );
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
