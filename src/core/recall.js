import { ERR, STATUS } from "./schema.js";
import { computeFreshness, decayedConfidence } from "./validity.js";

const DAY_MS = 86_400_000;

// Precision defaults — TASK-056
const DEFAULT_BUDGET = 700;
const DEFAULT_TOP_K = 8;
const MIN_SCORE = 0;

const FRESHNESS_MARKER = Object.freeze({
  fresh: "",
  stale: " ⚠️stale",
  expired: " ❌expired",
});

function renderFact(fact, freshnessInfo) {
  const [year, month, day] = String(fact.t_valid).slice(0, 10).split("-");
  void year;
  const marker = freshnessInfo ? (FRESHNESS_MARKER[freshnessInfo.freshness] ?? "") : "";
  const displayConfidence = freshnessInfo
    ? decayedConfidence(fact, freshnessInfo)
    : fact.confidence;
  return `- [${fact.scope}] ${fact.claim} (${Number(month)}/${Number(day)} 기준, 확신 ${Number(displayConfidence.toFixed(2))}${marker})`;
}

function visibleAt(fact, asOf, includeArchived) {
  if (!asOf) {
    return fact.status === STATUS.ACTIVE
      || (includeArchived && fact.status === STATUS.ARCHIVED);
  }
  if (fact.status === STATUS.ARCHIVED && !includeArchived) return false;
  if (![STATUS.ACTIVE, STATUS.SUPERSEDED, STATUS.INVALIDATED, STATUS.ARCHIVED].includes(fact.status)) {
    return false;
  }
  return fact.t_valid <= asOf && (fact.t_invalid === null || fact.t_invalid > asOf);
}

function scopeWeight(factScope, requestedScope) {
  if (!requestedScope || factScope === requestedScope) return 1;
  if (factScope === "person") return 0.8;
  return 0;
}

function recency(fact, referenceTime) {
  const validTime = Date.parse(fact.t_valid);
  if (!Number.isFinite(validTime)) return 1;
  const days = Math.max(0, (referenceTime - validTime) / DAY_MS);
  return Math.exp(-days / 90);
}

function projection(fact, freshnessInfo) {
  const base = {
    id: fact.id,
    claim: fact.claim,
    t_valid: fact.t_valid,
    confidence: fact.confidence,
    scope: fact.scope,
  };
  if (freshnessInfo) {
    base.freshness = freshnessInfo.freshness;
    if (freshnessInfo.freshness !== "fresh") {
      base.effective_confidence = decayedConfidence(fact, freshnessInfo);
    }
  }
  return base;
}

/**
 * Normalize bm25 rank (negative, lower=better) to 0..1 score.
 * bm25() in SQLite returns negative values; a perfect match might be -20,
 * a weak match near 0. We negate and apply 1/(1+exp(-x/5)) sigmoid.
 */
function normalizeFtsRank(rank) {
  const x = -rank; // flip: higher = more relevant
  return 1 / (1 + Math.exp(-x / 5));
}

export function recall(store, task, opts = {}) {
  const budget = opts.budget_tokens ?? DEFAULT_BUDGET;
  if (budget < 200) {
    const error = new Error(ERR.E_BUDGET_TOO_SMALL);
    error.code = ERR.E_BUDGET_TOO_SMALL;
    throw error;
  }

  const queryText = typeof task === "string" ? task : "";
  const scope = opts.scope;
  const asOf = opts.as_of;
  const includeArchived = opts.include_archived ?? false;
  const source = opts.source ?? "core";
  const ttlConfig = opts.ttl_days;
  const topK = opts.top_k ?? DEFAULT_TOP_K;
  const minScore = opts.min_score ?? MIN_SCORE;
  const candidates = new Map();
  const ranks = new Map();

  for (const match of store.searchFts(queryText, { limit: 100 })) {
    const fact = store.getFact(match.id);
    if (fact) {
      candidates.set(fact.id, fact);
      ranks.set(fact.id, Number(match.rank));
    }
  }

  // TASK-056: scope-filler removed for normal recall — only FTS candidates.
  // Exceptions: (1) as_of needs superseded facts (FTS only returns active),
  // (2) briefing needs recents for empty queries via _include_recents.
  if (asOf || includeArchived) {
    const recent = store.query({ scope, limit: 30 });
    for (const fact of recent) candidates.set(fact.id, fact);
  } else if (opts._include_recents && (scope || queryText.trim() === "")) {
    const recent = store.query({ scope, limit: 30 });
    for (const fact of recent) candidates.set(fact.id, fact);
  }

  const referenceTime = asOf && Number.isFinite(Date.parse(asOf)) ? Date.parse(asOf) : Date.now();
  const scored = [];
  for (const fact of candidates.values()) {
    if (!visibleAt(fact, asOf, includeArchived)) continue;
    const weight = scopeWeight(fact.scope, scope);
    if (weight === 0) continue;
    const rank = ranks.get(fact.id);
    // Non-FTS candidates (from _include_recents) get low base relevance
    const ftsNorm = rank === undefined ? 0.1 : normalizeFtsRank(rank);
    const freshnessInfo = computeFreshness(fact, referenceTime, ttlConfig);
    const effectiveConfidence = decayedConfidence(fact, freshnessInfo);
    const score = ftsNorm * recency(fact, referenceTime) * effectiveConfidence * weight;
    scored.push({ fact, score, freshnessInfo });
  }

  scored.sort((left, right) => right.score - left.score
    || String(right.fact.t_valid).localeCompare(String(left.fact.t_valid))
    || left.fact.id.localeCompare(right.fact.id));

  // TASK-056: top-k cap + minimum score cutoff (abstain when nothing relevant)
  const filtered = scored
    .filter(({ score }) => score >= minScore)
    .slice(0, topK);

  const facts = [];
  const lines = [];
  let tokensUsed = 0;
  for (const { fact, freshnessInfo } of filtered) {
    const line = renderFact(fact, freshnessInfo);
    const tokens = Math.ceil(line.length / 3);
    if (tokensUsed + tokens > budget) continue;
    facts.push(projection(fact, freshnessInfo));
    lines.push(line);
    tokensUsed += tokens;
  }

  const result = facts.length === 0
    ? { briefing: "", facts: [], tokens_used: 0, warning: ERR.W_EMPTY }
    : { briefing: lines.join("\n"), facts, tokens_used: tokensUsed };
  store.appendRecall({
    tool: opts.tool ?? "recall",
    query: queryText,
    scope,
    hits: facts.map((fact) => fact.id),
    source,
    returned_chars: result.briefing.length,
    session_id: opts.session_id,
  });
  return result;
}

export function briefing(store, context = "", scope, config = {}) {
  return recall(store, context, {
    budget_tokens: 2000,
    scope: scope ?? config.default_scope,
    source: config.source ?? "core",
    ttl_days: config.ttl_days,
    tool: "briefing",
    session_id: config.session_id,
    _include_recents: true,
    top_k: 20,
    min_score: 0.01,
  });
}
