import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall, briefing } from "../src/core/recall.js";
import {
  computeFreshness,
  decayedConfidence,
  findExpiredFacts,
  DEFAULT_TTL_DAYS,
} from "../src/core/validity.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-validity-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return store;
}

// --- computeFreshness tests ---

test("computeFreshness: fact within TTL is fresh", () => {
  const fact = { type: "episodic", t_valid: "2026-01-01", t_invalid: null };
  const ref = Date.parse("2026-02-01"); // 31 days, TTL=90
  const result = computeFreshness(fact, ref);
  assert.equal(result.freshness, "fresh");
  assert.equal(result.ttl_days, 90);
  assert(result.days_since_valid > 30 && result.days_since_valid < 32);
});

test("computeFreshness: fact past TTL is stale", () => {
  const fact = { type: "episodic", t_valid: "2025-01-01", t_invalid: null };
  const ref = Date.parse("2025-05-01"); // ~120 days, TTL=90
  const result = computeFreshness(fact, ref);
  assert.equal(result.freshness, "stale");
});

test("computeFreshness: fact past 2x TTL is expired", () => {
  const fact = { type: "episodic", t_valid: "2024-01-01", t_invalid: null };
  const ref = Date.parse("2025-01-01"); // ~365 days, TTL=90, 2x=180
  const result = computeFreshness(fact, ref);
  assert.equal(result.freshness, "expired");
});

test("computeFreshness: fact past t_invalid is expired", () => {
  const fact = { type: "semantic", t_valid: "2026-01-01", t_invalid: "2026-02-01" };
  const ref = Date.parse("2026-02-02");
  const result = computeFreshness(fact, ref);
  assert.equal(result.freshness, "expired");
});

test("computeFreshness: custom TTL config applies", () => {
  const fact = { type: "episodic", t_valid: "2026-01-01", t_invalid: null };
  const ref = Date.parse("2026-01-20"); // 19 days
  const result = computeFreshness(fact, ref, { episodic: 10 });
  assert.equal(result.freshness, "stale"); // 19 > 10 but < 20
  assert.equal(result.ttl_days, 10);
});

// --- decayedConfidence tests ---

test("decayedConfidence: fresh fact keeps original confidence", () => {
  const fact = { type: "episodic", confidence: 0.9, provenance: {} };
  const info = { freshness: "fresh", days_since_valid: 30, ttl_days: 90 };
  assert.equal(decayedConfidence(fact, info), 0.9);
});

test("decayedConfidence: stale fact without provenance decays", () => {
  const fact = { type: "episodic", confidence: 0.9, provenance: {} };
  const info = { freshness: "stale", days_since_valid: 120, ttl_days: 90 };
  const decayed = decayedConfidence(fact, info);
  // 30 days over TTL, decay = exp(-30/90) ≈ 0.716, result ≈ 0.645
  assert(decayed < 0.9, `expected decay, got ${decayed}`);
  assert(decayed > 0.5, `expected moderate decay, got ${decayed}`);
});

test("decayedConfidence: stale fact WITH verifiable provenance keeps confidence", () => {
  const fact = { type: "episodic", confidence: 0.9, provenance: { url: "https://example.com" } };
  const info = { freshness: "stale", days_since_valid: 120, ttl_days: 90 };
  assert.equal(decayedConfidence(fact, info), 0.9);
});

test("decayedConfidence: never goes below 0.1", () => {
  const fact = { type: "episodic", confidence: 0.3, provenance: {} };
  const info = { freshness: "expired", days_since_valid: 500, ttl_days: 90 };
  const decayed = decayedConfidence(fact, info);
  assert(decayed >= 0.1);
});

// --- briefing stale marker integration test ---

test("briefing shows stale marker for old facts", (t) => {
  const store = isolatedStore(t);

  // Add a fact with t_valid far in the past (>90 days = stale for episodic)
  remember(store, {
    claim: "서버 포트는 8080",
    scope: "project:alpha",
    type: "episodic",
    t_valid: "2025-01-01",
    confidence: 0.9,
  }, config);

  // Recall with current time (2026-07-18 ~ 560 days later → expired)
  const result = recall(store, "서버 포트", { scope: "project:alpha" });

  assert(result.briefing.includes("expired"), `expected expired marker in: ${result.briefing}`);
  assert(result.facts[0].freshness === "expired");
  assert(result.facts[0].effective_confidence < 0.9);
});

test("briefing does NOT show marker for fresh facts", (t) => {
  const store = isolatedStore(t);

  const today = new Date().toISOString().slice(0, 10);
  remember(store, {
    claim: "배포 환경은 프로덕션",
    scope: "project:beta",
    type: "semantic",
    t_valid: today,
    confidence: 0.85,
  }, config);

  const result = recall(store, "배포 환경", { scope: "project:beta" });

  assert(!result.briefing.includes("stale"), `unexpected stale in: ${result.briefing}`);
  assert(!result.briefing.includes("expired"), `unexpected expired in: ${result.briefing}`);
  assert.equal(result.facts[0].freshness, "fresh");
  assert.equal(result.facts[0].effective_confidence, undefined);
});

test("briefing shows stale (not expired) for fact just past TTL", (t) => {
  const store = isolatedStore(t);

  // 100 days ago from now, episodic TTL=90, should be stale (90-180)
  const hundredDaysAgo = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
  remember(store, {
    claim: "CI 파이프라인은 GitHub Actions",
    scope: "project:gamma",
    type: "episodic",
    t_valid: hundredDaysAgo,
    confidence: 0.8,
  }, config);

  const result = recall(store, "CI 파이프라인", { scope: "project:gamma" });

  assert(result.briefing.includes("stale"), `expected stale marker in: ${result.briefing}`);
  assert.equal(result.facts[0].freshness, "stale");
});

// --- edge cases ---

test("computeFreshness: null t_valid treated as expired (not silently fresh)", () => {
  const fact = { type: "episodic", t_valid: null, t_invalid: null };
  const ref = Date.now();
  const result = computeFreshness(fact, ref);
  assert.equal(result.freshness, "expired");
  assert.equal(result.days_since_valid, Infinity);
});

test("computeFreshness: undefined t_valid treated as expired", () => {
  const fact = { type: "semantic", t_invalid: null };
  const ref = Date.now();
  const result = computeFreshness(fact, ref);
  assert.equal(result.freshness, "expired");
});

test("decayedConfidence: Infinity days_since_valid returns floor 0.1", () => {
  const fact = { type: "episodic", confidence: 0.9, provenance: {} };
  const info = { freshness: "expired", days_since_valid: Infinity, ttl_days: 90 };
  assert.equal(decayedConfidence(fact, info), 0.1);
});

test("computeFreshness: midnight boundary — same day is fresh", () => {
  // Use ISO with explicit UTC to avoid timezone ambiguity
  const fact = { type: "episodic", t_valid: "2026-07-18T00:00:00.000Z", t_invalid: null };
  const ref = Date.parse("2026-07-18T23:59:59.999Z"); // same day, end of day
  const result = computeFreshness(fact, ref);
  assert.equal(result.freshness, "fresh");
  assert(result.days_since_valid < 1);
});

test("computeFreshness: date-only string vs ISO string give consistent results", () => {
  // Date-only "2026-01-01" is parsed as UTC midnight by Date.parse (ISO 8601 spec)
  const factDate = { type: "episodic", t_valid: "2026-01-01", t_invalid: null };
  const factIso = { type: "episodic", t_valid: "2026-01-01T00:00:00.000Z", t_invalid: null };
  const ref = Date.parse("2026-04-01T12:00:00.000Z");
  const resultDate = computeFreshness(factDate, ref);
  const resultIso = computeFreshness(factIso, ref);
  assert.equal(resultDate.freshness, resultIso.freshness);
  assert(Math.abs(resultDate.days_since_valid - resultIso.days_since_valid) < 0.01);
});

// --- findExpiredFacts test ---

test("findExpiredFacts identifies expired active facts", () => {
  const facts = [
    { id: "1", type: "episodic", t_valid: "2024-01-01", t_invalid: null, status: "active" },
    { id: "2", type: "semantic", t_valid: "2026-07-01", t_invalid: null, status: "active" },
    { id: "3", type: "episodic", t_valid: "2025-01-01", t_invalid: null, status: "superseded" },
  ];
  const ref = Date.parse("2026-07-18");
  const expired = findExpiredFacts(facts, ref);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].fact.id, "1");
});
