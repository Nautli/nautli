import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;

export const MIN_DECIDED = 20;
export const MIN_RECALL = 10;
export const DEFAULT_THRESHOLDS = Object.freeze({
  min_decided: MIN_DECIDED,
  min_recall: MIN_RECALL,
  approval_rate: 0.5,
  false_positive_rate: 0.5,
  useful_recall_ratio: 0.5,
});

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object" && !Array.isArray(entry)) entries.push(entry);
    } catch {
      // 계측은 손상된 한 줄 때문에 나머지 로컬 표본을 버리지 않는다.
    }
  }
  return entries;
}

function readEvents(home) {
  const directory = path.join(home, "events");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}\.jsonl$/u.test(file))
    .sort()
    .flatMap((file) => readJsonLines(path.join(directory, file)));
}

function readCaptureCards(home) {
  return readJsonLines(path.join(home, "review", "queue.jsonl"))
    .filter((entry) => entry.type === "capture");
}

function resolvedThresholds(thresholds = {}) {
  return {
    min_decided: thresholds.min_decided ?? MIN_DECIDED,
    min_recall: thresholds.min_recall ?? MIN_RECALL,
    approval_rate: thresholds.approval_rate ?? DEFAULT_THRESHOLDS.approval_rate,
    false_positive_rate: thresholds.false_positive_rate
      ?? DEFAULT_THRESHOLDS.false_positive_rate,
    useful_recall_ratio: thresholds.useful_recall_ratio
      ?? DEFAULT_THRESHOLDS.useful_recall_ratio,
  };
}

function validLatency(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function cardLatency(card) {
  const created = Date.parse(card.at);
  const handled = Date.parse(card.handled_at);
  if (!Number.isFinite(created) || !Number.isFinite(handled)) return null;
  return validLatency(handled - created);
}

function generatedAt(now) {
  const date = now === undefined ? new Date() : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid metrics clock");
  return date;
}

function verdictDetails(report, thresholds) {
  const limits = resolvedThresholds(thresholds);
  const decided = report?.sample?.decided_cards ?? 0;
  const recalls = report?.sample?.recall_events ?? 0;
  if (decided < limits.min_decided || recalls < limits.min_recall) {
    return {
      verdict: "INSUFFICIENT_SAMPLE",
      reason: `최소 표본이 더 필요합니다. 결정 ${decided}/${limits.min_decided}, 회상 ${recalls}/${limits.min_recall}.`,
    };
  }

  const auto = report?.metrics?.auto ?? report?.auto ?? {};
  const explicit = report?.metrics?.explicit ?? report?.explicit ?? {};
  const failures = [];
  if (auto.approval_rate === null
    || auto.approval_rate === undefined
    || auto.approval_rate < limits.approval_rate) {
    failures.push(`승인율 ${limits.approval_rate} 이상`);
  }
  if (auto.false_positive_rate === null
    || auto.false_positive_rate === undefined
    || auto.false_positive_rate > limits.false_positive_rate) {
    failures.push(`오탐률 ${limits.false_positive_rate} 이하`);
  }
  if (auto.useful_recall_rate === null
    || auto.useful_recall_rate === undefined
    || explicit.useful_recall_rate === null
    || explicit.useful_recall_rate === undefined
    || auto.useful_recall_rate < explicit.useful_recall_rate * limits.useful_recall_ratio) {
    failures.push(`자동 유용 회상률이 직접 저장의 ${limits.useful_recall_ratio}배 이상`);
  }

  if (failures.length === 0) {
    return { verdict: "PASS", reason: "자동 캡처 유지 기준을 모두 충족했습니다." };
  }
  return {
    verdict: "KILL",
    reason: `미달 기준: ${failures.join(", ")}. 수정 후보: 후보 추출 기준과 승인 전 검토 흐름을 조정하세요.`,
  };
}

export function evaluateVerdict(report, thresholds = DEFAULT_THRESHOLDS) {
  return verdictDetails(report, thresholds).verdict;
}

export function captureMetrics(home, { now } = {}) {
  const clock = generatedAt(now);
  const cards = readCaptureCards(home);
  const events = readEvents(home);
  const decisions = new Map();
  const autoFacts = new Set();
  const explicitFacts = new Set();
  const recallEvents = [];

  for (const event of events) {
    if (event.ev === "capture.decided" && typeof event.pair_id === "string") {
      decisions.set(event.pair_id, event);
    }
    if (event.ev === "fact.added" && typeof event.fact?.id === "string") {
      if (event.fact.provenance?.source === "capture") autoFacts.add(event.fact.id);
      else explicitFacts.add(event.fact.id);
    }
    if (event.type === "recall" && event.ev === undefined) recallEvents.push(event);
  }

  const counts = { remember: 0, dismissed: 0, deferred: 0, pending: 0 };
  const latencies = [];
  const sessionHashes = new Set();
  let firstCaptureTime = null;
  let firstCaptureAt = null;

  for (const card of cards) {
    const created = Date.parse(card.at);
    if (Number.isFinite(created) && (firstCaptureTime === null || created < firstCaptureTime)) {
      firstCaptureTime = created;
      firstCaptureAt = new Date(created).toISOString();
    }
    if (typeof card.session_id === "string" && card.session_id.length > 0) {
      sessionHashes.add(createHash("sha256").update(card.session_id).digest("hex"));
    }

    const decision = decisions.get(card.pair_id);
    const action = decision?.action ?? card.action;
    if (action === "remember" || action === "dismissed" || action === "deferred") {
      counts[action] += 1;
      const latency = decision ? validLatency(decision.latency_ms) : cardLatency(card);
      if (latency !== null) latencies.push(latency);
    } else {
      counts.pending += 1;
    }
  }

  const autoRecalled = new Set();
  const explicitRecalled = new Set();
  let autoRecallRefs = 0;
  let explicitRecallRefs = 0;
  for (const event of recallEvents) {
    if (!Array.isArray(event.hits)) continue;
    for (const id of event.hits) {
      if (autoFacts.has(id)) {
        autoRecalled.add(id);
        autoRecallRefs += 1;
      } else if (explicitFacts.has(id)) {
        explicitRecalled.add(id);
        explicitRecallRefs += 1;
      }
    }
  }

  const decidedForRates = counts.remember + counts.dismissed;
  const auto = {
    candidates: cards.length,
    approved: counts.remember,
    dismissed: counts.dismissed,
    deferred: counts.deferred,
    pending: counts.pending,
    approval_rate: ratio(counts.remember, decidedForRates),
    false_positive_rate: ratio(counts.dismissed, decidedForRates),
    median_review_latency_ms: median(latencies),
    facts: autoFacts.size,
    recalled_facts: autoRecalled.size,
    useful_recall_rate: ratio(autoRecalled.size, autoFacts.size),
    recall_refs_per_fact: ratio(autoRecallRefs, autoFacts.size),
  };
  const explicit = {
    facts: explicitFacts.size,
    recalled_facts: explicitRecalled.size,
    useful_recall_rate: ratio(explicitRecalled.size, explicitFacts.size),
    recall_refs_per_fact: ratio(explicitRecallRefs, explicitFacts.size),
  };
  const comparison = {
    useful_recall_delta: auto.useful_recall_rate === null || explicit.useful_recall_rate === null
      ? null
      : auto.useful_recall_rate - explicit.useful_recall_rate,
  };
  const sample = {
    decided_cards: counts.remember + counts.dismissed + counts.deferred,
    auto_facts: autoFacts.size,
    explicit_facts: explicitFacts.size,
    recall_events: recallEvents.length,
    capture_sessions: sessionHashes.size,
    first_capture_at: firstCaptureAt,
    window_days: firstCaptureTime === null
      ? 0
      : Math.max(0, Math.ceil((clock.getTime() - firstCaptureTime) / DAY_MS)),
  };
  const thresholds = resolvedThresholds(DEFAULT_THRESHOLDS);
  const report = {
    version: 1,
    kind: "capture-metrics",
    generated_at: clock.toISOString(),
    sample,
    metrics: { auto, explicit, comparison },
    verdict: null,
    verdict_reason: null,
    thresholds,
  };
  const result = verdictDetails(report, thresholds);
  report.verdict = result.verdict;
  report.verdict_reason = result.reason;
  return report;
}
