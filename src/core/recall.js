import { ERR, STATUS } from "./schema.js";
import { computeFreshness, decayedConfidence } from "./validity.js";

const DAY_MS = 86_400_000;

// Precision defaults — TASK-056
const DEFAULT_BUDGET = 700;
const DEFAULT_TOP_K = 8;
const MIN_SCORE = 0;

// TASK-013: 이웃 부스트 계산용 edge confidence 클램프(0..1, 비수치는 0.5).
function edgeConf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

const FRESHNESS_MARKER = Object.freeze({
  fresh: "",
  stale: " ⚠️stale",
  expired: " ❌expired",
});

// TASK-037: 미해결 충돌 마커 — recall/briefing 출력 텍스트에 그대로 실린다.
const CONFLICT_MARKER = " ⚠️미해결 충돌";

function renderFact(fact, freshnessInfo, conflictIds) {
  const [year, month, day] = String(fact.t_valid).slice(0, 10).split("-");
  void year;
  const marker = freshnessInfo ? (FRESHNESS_MARKER[freshnessInfo.freshness] ?? "") : "";
  const conflictMarker = conflictIds && conflictIds.length > 0 ? CONFLICT_MARKER : "";
  const displayConfidence = freshnessInfo
    ? decayedConfidence(fact, freshnessInfo)
    : fact.confidence;
  return `- [${fact.scope}] ${fact.claim} (${Number(month)}/${Number(day)} 기준, 확신 ${Number(displayConfidence.toFixed(2))}${marker}${conflictMarker})`;
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

// TASK-023: 요청 scope는 canonical+alias 집합으로 확장된다. 집합에 든 저장 scope는 완전 매치(1),
// person은 0.8 폴백, 그 외 0. 저장된 fact의 scope는 재기록되지 않고 그대로 남는다.
function scopeWeight(factScope, scopeSet) {
  if (!scopeSet || scopeSet.size === 0) return 1;
  if (scopeSet.has(factScope)) return 1;
  if (factScope === "person") return 0.8;
  return 0;
}

// TASK-023: recents 조회를 확장 scope 집합 전체에 대해 수행(별칭 scope의 fact도 포괄).
function queryRecents(store, scopeSet, limit) {
  if (!scopeSet || scopeSet.size === 0) return store.query({ limit });
  const merged = new Map();
  for (const scope of scopeSet) {
    for (const fact of store.query({ scope, limit })) merged.set(fact.id, fact);
  }
  return [...merged.values()];
}

function recency(fact, referenceTime) {
  const validTime = Date.parse(fact.t_valid);
  if (!Number.isFinite(validTime)) return 1;
  const days = Math.max(0, (referenceTime - validTime) / DAY_MS);
  return Math.exp(-days / 90);
}

function projection(fact, freshnessInfo, { related_via, conflicts_with } = {}) {
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
  // TASK-013: 이웃 부스트로 들어온 결과는 어느 seed에서 왔는지 표기(기존 fact 필드는 불변).
  if (related_via) base.related_via = related_via;
  // TASK-037: 미해결 충돌 상대 fact id들(파생 정보, 저장 fact는 불변).
  if (conflicts_with && conflicts_with.length > 0) base.conflicts_with = conflicts_with;
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
  // TASK-073: 예외 경로에서도 정확히 1개의 error 이벤트를 남기려면 로깅에 필요한 필드를 먼저 잡는다.
  const queryText = typeof task === "string" ? task : "";
  const scope = opts.scope;
  const source = opts.source ?? "core";
  const tool = opts.tool ?? "recall";
  const sessionId = opts.session_id;
  const shouldLog = opts.log !== false;
  try {
    return recallInner(store, task, opts, { queryText, scope, source, tool, sessionId, shouldLog });
  } catch (error) {
    // TASK-073: recall/briefing 예외 경로 — JSON 에러를 반환하기 전에 error 이벤트를 정확히 1회 기록.
    if (shouldLog) {
      try {
        store.appendRecall({
          tool,
          query: queryText,
          scope,
          hits: [],
          source,
          session_id: sessionId,
          outcome: "error",
          error_code: typeof error?.code === "string" && error.code !== "" ? error.code : ERR.E_INVALID_INPUT,
        });
      } catch {
        // 계측 기록 실패가 원래 에러를 가리지 않게 한다.
      }
    }
    throw error;
  }
}

function recallInner(store, task, opts, logCtx) {
  const budget = opts.budget_tokens ?? DEFAULT_BUDGET;
  if (budget < 200) {
    const error = new Error(ERR.E_BUDGET_TOO_SMALL);
    error.code = ERR.E_BUDGET_TOO_SMALL;
    throw error;
  }

  const queryText = logCtx.queryText;
  const scope = logCtx.scope;
  const asOf = opts.as_of;
  const includeArchived = opts.include_archived ?? false;
  const source = logCtx.source;
  const ttlConfig = opts.ttl_days;
  const topK = opts.top_k ?? DEFAULT_TOP_K;
  const minScore = opts.min_score ?? MIN_SCORE;
  const candidates = new Map();
  const ranks = new Map();

  // TASK-023: 요청 scope를 canonical+alias 집합으로 확장한다(저장 fact scope는 불변).
  const scopeSet = new Set(
    scope !== undefined && typeof store.expandScope === "function"
      ? store.expandScope(scope)
      : scope !== undefined
        ? [scope]
        : [],
  );

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
    for (const fact of queryRecents(store, scopeSet, 30)) candidates.set(fact.id, fact);
  } else if (opts._include_recents && (scope || queryText.trim() === "")) {
    for (const fact of queryRecents(store, scopeSet, 30)) candidates.set(fact.id, fact);
  }

  const referenceTime = asOf && Number.isFinite(Date.parse(asOf)) ? Date.parse(asOf) : Date.now();
  const scored = [];
  const seedScoreById = new Map();
  for (const fact of candidates.values()) {
    if (!visibleAt(fact, asOf, includeArchived)) continue;
    const weight = scopeWeight(fact.scope, scopeSet);
    if (weight === 0) continue;
    const rank = ranks.get(fact.id);
    // Non-FTS candidates (from _include_recents) get low base relevance
    const ftsNorm = rank === undefined ? 0.1 : normalizeFtsRank(rank);
    const freshnessInfo = computeFreshness(fact, referenceTime, ttlConfig);
    const effectiveConfidence = decayedConfidence(fact, freshnessInfo);
    const score = ftsNorm * recency(fact, referenceTime) * effectiveConfidence * weight;
    scored.push({ fact, score, freshnessInfo });
    seedScoreById.set(fact.id, score);
  }

  // TASK-013: FTS seed의 1-hop ACTIVE 이웃만 부스트로 병합한다(재귀 확장 없음).
  // 이웃 점수 = seed_score × 0.35 × edge.confidence → 항상 seed보다 낮은 랭크.
  // 병합 집합에는 동일한 scope/top-k/budget 규칙이 그대로 적용된다.
  if (typeof store.activeNeighbors === "function") {
    const neighborBest = new Map(); // neighborId -> { score, via }
    for (const [seedId, seedScore] of seedScoreById) {
      if (seedScore <= 0) continue; // 0점 seed는 이웃을 끌어올리지 않는다
      for (const edge of store.activeNeighbors(seedId)) {
        const neighborId = edge.neighbor_id;
        if (candidates.has(neighborId)) continue; // 이미 seed면 그대로(더 높은 점수 유지)
        const neighborScore = seedScore * 0.35 * edgeConf(edge.confidence);
        const existing = neighborBest.get(neighborId);
        if (!existing || neighborScore > existing.score) {
          neighborBest.set(neighborId, { score: neighborScore, via: seedId });
        }
      }
    }
    for (const [neighborId, { score, via }] of neighborBest) {
      const fact = store.getFact(neighborId);
      if (!fact) continue;
      if (!visibleAt(fact, asOf, includeArchived)) continue;
      if (scopeWeight(fact.scope, scopeSet) === 0) continue; // 병합 집합에도 scope 규칙 적용
      const freshnessInfo = computeFreshness(fact, referenceTime, ttlConfig);
      scored.push({ fact, score, freshnessInfo, related_via: via });
    }
  }

  scored.sort((left, right) => right.score - left.score
    || String(right.fact.t_valid).localeCompare(String(left.fact.t_valid))
    || left.fact.id.localeCompare(right.fact.id));

  // TASK-056: top-k cap + minimum score cutoff (abstain when nothing relevant)
  const filtered = scored
    .filter(({ score }) => score >= minScore)
    .slice(0, topK);

  // TASK-037: 미해결 충돌 맵을 한 번 계산해 반환되는 fact에 conflicts_with·마커를 붙인다.
  const conflicts = typeof store.activeContradictions === "function"
    ? store.activeContradictions()
    : new Map();

  const facts = [];
  const lines = [];
  let tokensUsed = 0;
  for (const { fact, freshnessInfo, related_via } of filtered) {
    const conflictIds = conflicts.has(fact.id) ? [...conflicts.get(fact.id)] : [];
    const line = renderFact(fact, freshnessInfo, conflictIds);
    const tokens = Math.ceil(line.length / 3);
    if (tokensUsed + tokens > budget) continue;
    facts.push(projection(fact, freshnessInfo, { related_via, conflicts_with: conflictIds }));
    lines.push(line);
    tokensUsed += tokens;
  }

  const result = facts.length === 0
    ? { briefing: "", facts: [], tokens_used: 0, warning: ERR.W_EMPTY }
    : { briefing: lines.join("\n"), facts, tokens_used: tokensUsed };
  // TASK-104: 표면(대시보드 등)이 최종 렌더 hit 집합으로 자기 tool 이름을 직접 로깅할 때는
  // 내부 recall 로깅을 끈다(전달 중복 계수 방지). 기본은 로깅 on.
  if (logCtx.shouldLog) {
    store.appendRecall({
      tool: logCtx.tool,
      query: queryText,
      scope,
      hits: facts.map((fact) => fact.id),
      source,
      returned_chars: result.briefing.length,
      session_id: logCtx.sessionId,
      // TASK-073: hit(1건 이상) vs empty(0건) outcome을 성공 경로에 찍는다.
      outcome: facts.length > 0 ? "hit" : "empty",
    });
  }
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
