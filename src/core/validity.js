/**
 * Validity window — freshness calculation + confidence decay.
 *
 * Facts have t_valid (when known-true) and optional t_invalid (when known-false).
 * This module computes freshness status and applies time-based confidence decay
 * for facts lacking provenance that could be re-verified.
 */

const DAY_MS = 86_400_000;

// Default TTL in days by fact type. Overridable via config.ttl_days.
const DEFAULT_TTL_DAYS = Object.freeze({
  episodic: 90,    // events decay fast
  semantic: 365,   // knowledge decays slower
  procedural: 180, // procedures change moderately
});

/**
 * @typedef {"fresh"|"stale"|"expired"} Freshness
 */

/**
 * Compute freshness status of a fact relative to a reference time.
 *
 * - fresh: within TTL
 * - stale: past TTL but within 2× TTL (grace period)
 * - expired: past 2× TTL or past t_invalid
 *
 * @param {object} fact
 * @param {number} referenceMs - reference time in ms (Date.now())
 * @param {object} [ttlConfig] - per-type TTL overrides in days
 * @returns {{ freshness: Freshness, days_since_valid: number, ttl_days: number }}
 */
export function computeFreshness(fact, referenceMs, ttlConfig) {
  const ttlDays = ttlConfig?.[fact.type] ?? DEFAULT_TTL_DAYS[fact.type] ?? DEFAULT_TTL_DAYS.episodic;
  const validMs = typeof fact.t_valid === "string" ? Date.parse(fact.t_valid) : NaN;
  // Unparseable or missing t_valid → treat as maximally stale (expired) rather than silently fresh
  if (!Number.isFinite(validMs)) {
    return { freshness: "expired", days_since_valid: Infinity, ttl_days: ttlDays };
  }
  const daysSinceValid = Math.max(0, (referenceMs - validMs) / DAY_MS);

  // If t_invalid is set and we're past it, expired
  if (fact.t_invalid) {
    const invalidMs = Date.parse(fact.t_invalid);
    if (Number.isFinite(invalidMs) && referenceMs >= invalidMs) {
      return { freshness: "expired", days_since_valid: daysSinceValid, ttl_days: ttlDays };
    }
  }

  if (daysSinceValid > ttlDays * 2) {
    return { freshness: "expired", days_since_valid: daysSinceValid, ttl_days: ttlDays };
  }
  if (daysSinceValid > ttlDays) {
    return { freshness: "stale", days_since_valid: daysSinceValid, ttl_days: ttlDays };
  }
  return { freshness: "fresh", days_since_valid: daysSinceValid, ttl_days: ttlDays };
}

/**
 * Whether a fact has re-verifiable provenance (URL, command, API source).
 */
export function hasVerifiableProvenance(fact) {
  const prov = fact.provenance;
  if (!prov || typeof prov !== "object") return false;
  return Boolean(prov.url || prov.command || prov.api);
}

/**
 * Apply time-based confidence decay for non-fresh facts without verifiable provenance.
 * Returns adjusted confidence (never below 0.1).
 *
 * Decay formula: confidence * exp(-(days_over_ttl) / ttl_days)
 * Only applies to stale/expired facts without verifiable provenance.
 *
 * @param {object} fact
 * @param {{ freshness: string, days_since_valid: number, ttl_days: number }} freshnessInfo
 * @returns {number} decayed confidence
 */
export function decayedConfidence(fact, freshnessInfo) {
  if (freshnessInfo.freshness === "fresh") return fact.confidence;
  if (hasVerifiableProvenance(fact)) return fact.confidence;

  const daysOverTtl = Math.max(0, freshnessInfo.days_since_valid - freshnessInfo.ttl_days);
  if (!Number.isFinite(daysOverTtl)) return 0.1;
  const decay = Math.exp(-daysOverTtl / freshnessInfo.ttl_days);
  return Math.max(0.1, fact.confidence * decay);
}

/**
 * Identify facts that are expired and should enter needs_review queue.
 * Returns array of { fact, freshness_info } for expired active facts.
 */
export function findExpiredFacts(facts, referenceMs, ttlConfig) {
  const results = [];
  for (const fact of facts) {
    if (fact.status !== "active") continue;
    const info = computeFreshness(fact, referenceMs, ttlConfig);
    if (info.freshness === "expired") {
      results.push({ fact, freshness_info: info });
    }
  }
  return results;
}

export { DEFAULT_TTL_DAYS };
