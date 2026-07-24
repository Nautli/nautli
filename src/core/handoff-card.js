/**
 * Handoff Card v2 — "오늘의 인수인계 카드"
 *
 * Replaces the v1 savings receipt (activity counts only) with an observation-based
 * card that shows: ① a representative delivered fact, ② where work stopped,
 * ③ new/replaced fact delta, ④ memory token measurement.
 *
 * Design constraints (sol 2R 2026-07-18):
 * - No causal language ("아꼈다/면했다/절감했다") — only observational ("건넸다/전달됐다")
 * - No overall savings percentage until experiment sample flag is true
 * - Skip card when there is no delta (no new facts, no deliveries)
 */

import fs from "node:fs";
import path from "node:path";
import { readLogicalEvents } from "./store.js";

const DAY_MS = 86_400_000;

// ── Causal language guard ──────────────────────────────────────────────
// These patterns must never appear in user-facing handoff card copy.
// Only observational phrasing is allowed.
export const CAUSAL_BANNED_PATTERNS = [
  /아꼈/u,
  /면했/u,
  /절감했/u,
  /절감률/u,
  /절약했/u,
  /saved/iu,
  /savings/iu,
  /avoided/iu,
  /reduced/iu,
];

export function assertNoCausalLanguage(text) {
  for (const pattern of CAUSAL_BANNED_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Causal language detected in handoff card: "${text}" matches ${pattern}`);
    }
  }
}

// ── Savings percentage gate ────────────────────────────────────────────
// Overall savings % is banned until an experiment sample is available.
export function savingsPercentage(numerator, denominator, { experimentSampleReady = false } = {}) {
  if (!experimentSampleReady) {
    throw new Error(
      "Savings percentage is blocked: experiment sample is not ready. "
      + "Set experimentSampleReady=true only after controlled experiment data is collected.",
    );
  }
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 100);
}

// ── Internal helpers ───────────────────────────────────────────────────

// TASK-BATCH-FIX (F-7): consume the ev_id first-wins logical reader (same one audit uses) so a
// duplicated ev_id line does not double-count deliveries/delta versus audit. The per-caller inWindow
// filter still scopes results to the report window; cutoff/now are kept for signature stability.
function eventsInWindow(home, cutoff, now) {
  void cutoff;
  void now;
  if (!fs.existsSync(path.join(home, "events"))) return [];
  return readLogicalEvents(home)
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
}

function inWindow(value, cutoff, now) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= cutoff && time <= now;
}

// ── Block ①: Representative delivered fact ─────────────────────────────
// A fact is "전달됨" if it appears in `hits` of a recall event in the window.
function findDeliveredFact(events, store, cutoff, now) {
  const deliveredIds = new Map(); // factId -> delivery count
  const factSessions = new Map(); // factId -> Set<sessionKey>

  for (const event of events) {
    if (event.type !== "recall"
      || event.ev !== undefined
      || !Array.isArray(event.hits)
      || event.hits.length === 0
      || !inWindow(event.at, cutoff, now)) continue;

    // TASK-104: session_id는 이제 항상 기록되며 미상은 "unknown" 센티널이다 —
    // 실제 세션 식별자일 때만 세션 단위로 세고, "unknown"/결측은 시간 버킷으로 폴백한다.
    const sessionKey = event.session_id && event.session_id !== "unknown"
      ? event.session_id
      : `bucket:${Math.floor(Date.parse(event.at) / 600000)}`;

    for (const factId of event.hits) {
      if (typeof factId !== "string") continue;
      deliveredIds.set(factId, (deliveredIds.get(factId) || 0) + 1);
      if (!factSessions.has(factId)) factSessions.set(factId, new Set());
      factSessions.get(factId).add(sessionKey);
    }
  }

  if (deliveredIds.size === 0) return null;

  // Pick the most-delivered fact
  let bestId = null;
  let bestCount = 0;
  for (const [id, count] of deliveredIds) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }

  const fact = store?.getFact?.(bestId);
  const claim = fact?.claim ?? null;

  return {
    fact_id: bestId,
    claim,
    delivery_count: bestCount,
    session_count: factSessions.get(bestId)?.size ?? 1,
  };
}

// ── Block ②: Where work stopped ───────────────────────────────────────
function findLastActivity(events, cutoff, now) {
  let latest = null;
  let latestTime = 0;

  for (const event of events) {
    if (!inWindow(event.at, cutoff, now)) continue;
    const time = Date.parse(event.at);
    if (time > latestTime) {
      latestTime = time;
      latest = event;
    }
  }

  if (!latest) return null;

  // Extract project/scope from the most recent event
  const scope = latest.scope
    ?? latest.fact?.scope
    ?? null;

  return {
    scope,
    at: latest.at,
    type: latest.type ?? latest.ev ?? null,
  };
}

// ── Block ③: New/replaced fact delta ──────────────────────────────────
function findFactsDelta(events, store, cutoff, now) {
  const added = [];
  const replaced = [];

  for (const event of events) {
    if (!inWindow(event.at, cutoff, now)) continue;

    if (event.ev === "fact.added"
      && (event.fact?.status === undefined || event.fact?.status === "active")) {
      added.push({
        id: event.fact?.id,
        claim: event.fact?.claim,
        scope: event.fact?.scope,
      });
    } else if (event.ev === "fact.superseded" && event.id) {
      const oldFact = store?.getFact?.(event.id);
      const newId = oldFact?.superseded_by;
      const newFact = newId ? store?.getFact?.(newId) : null;
      replaced.push({
        old_id: event.id,
        old_claim: oldFact?.claim ?? null,
        new_id: newId ?? null,
        new_claim: newFact?.claim ?? null,
      });
    }
  }

  return { added, replaced };
}

// ── Block ④: Memory token measurement ─────────────────────────────────

// Uses DB (sum of active claims) instead of instruction-file stat — always up-to-date regardless of sync state.
function baselineTokens(store) {
  if (!store?.db?.open) return 0;
  try {
    const row = store.db.prepare(
      "SELECT sum(length(claim)) AS total_chars FROM facts WHERE status = 'active'",
    ).get();
    return Math.ceil((row?.total_chars ?? 0) / 4);
  } catch {
    return 0;
  }
}

function measureTokens(events, store, cutoff, now) {
  let injectedChars = 0;

  for (const event of events) {
    if (event.type !== "recall"
      || event.ev !== undefined
      || !inWindow(event.at, cutoff, now)) continue;

    if (Number.isFinite(event.returned_chars) && event.returned_chars >= 0) {
      injectedChars += event.returned_chars;
    }
  }

  const baseline = baselineTokens(store);

  return {
    injected_tokens: Math.ceil(injectedChars / 4),
    injected_chars: injectedChars,
    baseline_tokens: baseline,
  };
}

// ── Main builder ───────────────────────────────────────────────────────

/**
 * Build the handoff card for the daily report.
 *
 * @param {string} home - nautli home directory
 * @param {object} store - Store instance (for getFact)
 * @param {object} [options]
 * @param {number} [options.days=1] - window in days (default: yesterday only)
 * @param {string|Date} [options.now] - reference time
 * @returns {object|null} - card data or null if nothing to report
 */
export function buildHandoffCard(home, store, { days = 1, now } = {}) {
  const windowDays = Number.isFinite(Number(days)) && Number(days) > 0
    ? Number(days)
    : 1;
  const clock = now === undefined ? new Date() : new Date(now);
  if (!Number.isFinite(clock.getTime())) throw new TypeError("Invalid handoff card clock");
  const nowTime = clock.getTime();
  const cutoff = nowTime - windowDays * DAY_MS;

  const events = eventsInWindow(home, cutoff, nowTime);

  const delivered = findDeliveredFact(events, store, cutoff, nowTime);
  const lastActivity = findLastActivity(events, cutoff, nowTime);
  const delta = findFactsDelta(events, store, cutoff, nowTime);
  const tokens = measureTokens(events, store, cutoff, nowTime);

  const hasDelivery = delivered !== null;
  const hasDelta = delta.added.length > 0 || delta.replaced.length > 0;

  if (!hasDelivery && !hasDelta) {
    return null;
  }

  return {
    window_days: windowDays,
    since_at: new Date(cutoff).toISOString(),
    generated_at: clock.toISOString(),
    delivered,
    last_activity: lastActivity,
    delta,
    tokens,
    has_content: hasDelivery || hasDelta,
  };
}

// ── Rendered fact-id set (TASK-104) ────────────────────────────────────
// The exact fact ids whose claim/topic renderHandoffCard actually renders —
// mirrors the renderer's slices so delivery logging counts only shown facts.
export function handoffCardFactIds(card) {
  if (!card) return [];
  const ids = [];
  const push = (id) => {
    if (typeof id === "string" && id !== "" && !ids.includes(id)) ids.push(id);
  };
  if (card.delivered) push(card.delivered.fact_id);
  for (const added of card.delta.added.slice(0, 5)) push(added.id);
  for (const replaced of card.delta.replaced.slice(0, 5)) {
    push(replaced.old_id);
    push(replaced.new_id);
  }
  return ids;
}

// ── Markdown renderer for daemon report ────────────────────────────────

export function renderHandoffCard(card, t) {
  if (!card) return null;

  const lines = [];
  lines.push(t("report.handoff_heading"));

  // Block ① — delivered fact
  if (card.delivered) {
    const claim = card.delivered.claim
      ? `"${card.delivered.claim}"`
      : card.delivered.fact_id;
    lines.push(t("report.handoff_delivered", {
      claim,
      sessions: card.delivered.session_count,
    }));
  }

  // Block ② — where work stopped
  if (card.last_activity) {
    const scope = card.last_activity.scope ?? "-";
    lines.push(t("report.handoff_last_activity", { scope, at: card.last_activity.at }));
  }

  // Block ③ — fact delta
  if (card.delta.added.length > 0 || card.delta.replaced.length > 0) {
    lines.push(t("report.handoff_delta_heading"));
    for (const added of card.delta.added.slice(0, 5)) {
      lines.push(t("report.handoff_delta_added", { claim: added.claim ?? added.id }));
    }
    for (const replaced of card.delta.replaced.slice(0, 5)) {
      const oldText = replaced.old_claim ?? replaced.old_id ?? "?";
      const newText = replaced.new_claim ?? replaced.new_id ?? "?";
      lines.push(t("report.handoff_delta_replaced", { old: oldText, new: newText }));
    }
    if (card.delta.added.length + card.delta.replaced.length > 10) {
      const remaining = card.delta.added.length + card.delta.replaced.length - 10;
      lines.push(t("report.handoff_delta_more", { count: remaining }));
    }
  }

  // Block ④ — token measurement with baseline comparison
  if (card.tokens.injected_tokens > 0) {
    if (card.tokens.baseline_tokens > 0) {
      const pct = Math.round(
        ((card.tokens.baseline_tokens - card.tokens.injected_tokens) / card.tokens.baseline_tokens) * 100,
      );
      lines.push(t("report.handoff_tokens_baseline", {
        tokens: card.tokens.injected_tokens,
        baseline_tokens: card.tokens.baseline_tokens,
        pct: Math.max(0, pct),
      }));
    } else {
      lines.push(t("report.handoff_tokens", { tokens: card.tokens.injected_tokens }));
    }
  }

  // Guard: verify no causal language leaked into output
  const output = lines.join("\n");
  assertNoCausalLanguage(output);

  return output;
}
