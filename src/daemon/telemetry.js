import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 5_000;
const DEFAULT_ENDPOINT = "https://telemetry.nautli.ai/v1/daily";
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROUTES = new Set(["human", "machine", "auto", "remember", "hold"]);
const RESOLVER_DECISIONS = new Set([
  "a_wins",
  "b_wins",
  "both_invalid",
  "both_valid",
  "remember",
  "discard",
  "needs_human",
  "unresolved",
]);
const USER_ACTIONS = new Set([
  "merge",
  "keep_separate",
  "defer",
  "newer_wins",
  "older_wins",
  "a_wins",
  "b_wins",
  "both_valid",
  "unknown",
  "other",
  "report_issue",
  "remember",
  "dismissed",
  "deferred",
]);
const payloadHomes = new WeakMap();
const packageFile = fileURLToPath(new URL("../../package.json", import.meta.url));
const APP_VERSION = JSON.parse(fs.readFileSync(packageFile, "utf8")).version;

function readConfig(home) {
  const file = path.join(home, "config.json");
  if (!fs.existsSync(file)) return {};
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const values = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) values.push(value);
    } catch {
      // 텔레메트리는 손상된 로컬 기록 때문에 제품 동작을 방해하지 않는다.
    }
  }
  return values;
}

function recent(value, cutoff, now) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= cutoff && time <= now;
}

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function confidenceBucket(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return (Math.min(10, Math.floor((confidence + Number.EPSILON) * 10)) / 10).toFixed(1);
}

function scopeClass(scope) {
  if (scope === "person") return "person";
  if (scope === "procedure") return "procedure";
  if (typeof scope === "string" && scope.startsWith("project:")) return "project";
  return null;
}

function ensureInstallId(home) {
  const config = readConfig(home);
  const telemetry = config.telemetry && typeof config.telemetry === "object"
    && !Array.isArray(config.telemetry)
    ? config.telemetry
    : {};
  if (typeof telemetry.install_id === "string"
    && INSTALL_ID_PATTERN.test(telemetry.install_id)) return telemetry.install_id;

  const installId = randomUUID();
  writeConfig(home, {
    ...config,
    telemetry: { ...telemetry, install_id: installId },
  });
  return installId;
}

function currentFacts(store) {
  try {
    return typeof store?.query === "function" ? store.query() : [];
  } catch {
    return [];
  }
}

export function isTelemetryEnabled(config) {
  return config?.telemetry?.enabled === true;
}

export function buildTelemetryPayload(home, store) {
  const now = Date.now();
  const cutoff = now - DAY_MS;
  const queue = readJsonl(path.join(home, "review", "queue.jsonl"));
  const journal = readJsonl(path.join(home, "daemon", "journal.jsonl"));
  const pairCards = new Set();
  const captureCards = new Set();
  const recentQueuedPairs = new Set();

  for (const entry of journal) {
    if (entry.kind !== "judgment" || entry.outcome !== "queued" || !recent(entry.at, cutoff, now)) {
      continue;
    }
    if (typeof entry.pair_id === "string") {
      pairCards.add(entry.pair_id);
      recentQueuedPairs.add(entry.pair_id);
    }
  }

  const triageRoutes = {};
  const resolverDecisions = {};
  const userActions = {};
  let userOverrideOfAi = 0;
  let pendingTotal = 0;

  for (const entry of queue) {
    if (entry.status === "pending") pendingTotal += 1;

    if (entry.type === "capture") {
      if (recent(entry.at, cutoff, now) && typeof entry.pair_id === "string") {
        captureCards.add(entry.pair_id);
      }
    } else if (recent(entry.at, cutoff, now) && typeof entry.pair_id === "string") {
      pairCards.add(entry.pair_id);
    }

    const route = ROUTES.has(entry.route) ? entry.route : null;
    const routeIsRecent = recent(entry.routed_at, cutoff, now)
      || (route === "human" && recentQueuedPairs.has(entry.pair_id))
      || recent(entry.at, cutoff, now);
    if (route && routeIsRecent) increment(triageRoutes, route);
    if (entry.answered_by === "triage"
      && entry.action === "remember"
      && recent(entry.handled_at, cutoff, now)) increment(triageRoutes, "remember");

    const resolverDecision = RESOLVER_DECISIONS.has(entry.resolver_decision)
      ? entry.resolver_decision
      : entry.answered_by === "oracle" && RESOLVER_DECISIONS.has(entry.action)
        ? entry.action
        : null;
    const resolverAt = entry.resolver_at ?? entry.handled_at;
    if (resolverDecision && recent(resolverAt, cutoff, now)) {
      const bucket = confidenceBucket(entry.resolver_confidence ?? entry.confidence);
      const decision = resolverDecisions[resolverDecision] ?? { count: 0, confidence_buckets: {} };
      decision.count += 1;
      if (bucket !== null) increment(decision.confidence_buckets, bucket);
      resolverDecisions[resolverDecision] = decision;
    }

    const isUser = entry.answered_by !== "oracle" && entry.answered_by !== "triage";
    if (isUser && USER_ACTIONS.has(entry.action) && recent(entry.handled_at, cutoff, now)) {
      increment(userActions, entry.action);
      if ((entry.recommend === "remember" || entry.recommend === "dismissed")
        && (entry.action === "remember" || entry.action === "dismissed")
        && entry.recommend !== entry.action) userOverrideOfAi += 1;
    }
  }

  const facts = currentFacts(store);
  const factsByScope = { person: 0, project: 0, procedure: 0 };
  for (const fact of facts) {
    const category = scopeClass(fact?.scope);
    if (category) factsByScope[category] += 1;
  }
  let factsTotal = facts.length;
  try {
    const total = store?.stats?.().total;
    if (Number.isSafeInteger(total) && total >= 0) factsTotal = total;
  } catch {
    // 읽기 실패 시 이미 얻은 사실 배열 길이만 사용한다.
  }

  // shadow resolve 통계: undo ledger에서 shadow_resolved_at 기준으로 집계
  const shadowResolve = { corroborated: 0, contradicted: 0, no_signal: 0 };
  const undoLedger = readJsonl(path.join(home, "review", "undo-ledger.jsonl"));
  for (const entry of undoLedger) {
    if (!entry.shadow_resolved_at || !recent(entry.shadow_resolved_at, cutoff, now)) continue;
    if (entry.shadow_decision === "corroborate") shadowResolve.corroborated += 1;
    else if (entry.shadow_decision === "contradict") shadowResolve.contradicted += 1;
  }
  // no_signal은 이벤트 로그에서 집계 (ledger에 기록되지 않음)
  const events = readJsonl(path.join(home, "events",
    `${new Date(now).toISOString().slice(0, 7)}.jsonl`));
  for (const event of events) {
    if (event?.ev === "shadow.resolve_cycle" && recent(event.at, cutoff, now)) {
      shadowResolve.no_signal += (event.no_signal ?? 0);
    }
  }

  const payload = {
    schema_version: 1,
    install_id: ensureInstallId(home),
    app_version: APP_VERSION,
    platform: process.platform,
    counts: {
      cards_created_by_type: { pair: pairCards.size, capture: captureCards.size },
      triage_routes: triageRoutes,
      resolver_decisions: resolverDecisions,
      user_actions: userActions,
      user_override_of_ai: userOverrideOfAi,
      pending_total: pendingTotal,
      facts_total: factsTotal,
      facts_by_scope: factsByScope,
      shadow_resolve: shadowResolve,
    },
  };
  payloadHomes.set(payload, home);
  return payload;
}

function telemetryHome(config) {
  const value = config?.__telemetryHome ?? config?.home;
  return typeof value === "string" && value !== "" ? path.resolve(value) : null;
}

function recordLastSent(home, config, at) {
  if (!home) return;
  const saved = readConfig(home);
  const savedTelemetry = saved.telemetry && typeof saved.telemetry === "object"
    && !Array.isArray(saved.telemetry)
    ? saved.telemetry
    : {};
  writeConfig(home, {
    ...saved,
    telemetry: { ...savedTelemetry, last_sent_at: at },
  });
  if (config?.telemetry && typeof config.telemetry === "object") {
    config.telemetry.last_sent_at = at;
  }
}

function logFailure(home) {
  if (!home) return;
  try {
    const file = path.join(home, "daemon", "telemetry.log");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} send_failed\n`, "utf8");
  } catch {
    // 실패 기록조차 제품 동작에 영향을 주지 않는다.
  }
}

export async function sendTelemetry(payload, config = {}) {
  const endpoint = config?.telemetry?.endpoint
    || process.env.NAUTLI_TELEMETRY_URL
    || DEFAULT_ENDPOINT;
  const home = telemetryHome(config) ?? payloadHomes.get(payload) ?? null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    try {
      recordLastSent(home, config, new Date().toISOString());
    } catch {
      // 전송 성공 기록 실패도 제품 동작과 전송 결과를 바꾸지 않는다.
    }
    return true;
  } catch {
    logFailure(home);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
