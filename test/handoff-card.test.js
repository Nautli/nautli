import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildHandoffCard,
  renderHandoffCard,
  assertNoCausalLanguage,
  savingsPercentage,
  CAUSAL_BANNED_PATTERNS,
} from "../src/core/handoff-card.js";
import { newId, claimHash } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";
import { makeT } from "../src/i18n/strings.js";

function makeFact(overrides = {}) {
  const claim = overrides.claim ?? "test fact";
  return {
    id: overrides.id ?? newId(),
    type: overrides.type ?? "semantic",
    scope: overrides.scope ?? "project:test",
    subject: overrides.subject ?? "",
    claim,
    confidence: overrides.confidence ?? 0.9,
    provenance: overrides.provenance ?? {},
    t_valid: overrides.t_valid ?? "2026-07-18",
    t_invalid: null,
    t_expired: null,
    superseded_by: null,
    status: overrides.status ?? "active",
    claim_hash: claimHash(claim),
  };
}

const NOW = "2026-07-18T12:00:00.000Z";

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-handoff-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

// ── buildHandoffCard ───────────────────────────────────────────────────

test("empty store returns null (no card to emit)", (t) => {
  const { home, store } = isolatedStore(t);
  const card = buildHandoffCard(home, store, { now: NOW });
  assert.equal(card, null);
});

test("recall events produce a delivered fact block", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T08:00:00.000Z";
  // Store a fact first
  const factData = makeFact({ claim: "nautli uses on-demand recall", scope: "project:nautli" });
  store.addFact(factData);
  const factId = factData.id;
  // Simulate recall that delivered this fact
  store.appendRecall({
    hits: [factId],
    session_id: "session-x",
    returned_chars: 100,
    at,
  });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  assert.ok(card, "card should not be null");
  assert.ok(card.delivered, "delivered block should exist");
  assert.equal(card.delivered.fact_id, factId);
  assert.equal(card.delivered.session_count, 1);
  assert.ok(card.delivered.claim.includes("nautli"));
  assert.equal(card.tokens.injected_tokens, 25); // 100 chars / 4
});

test("delivered fact only counts recall events with hits (not empty recalls)", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T08:00:00.000Z";
  // Empty recall (no hits)
  store.appendRecall({ hits: [], session_id: "session-empty", returned_chars: 0, at });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  assert.equal(card, null, "no card when no deliveries or delta");
});

test("fact delta block captures added and superseded facts", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T09:00:00.000Z";

  // Add a fact
  store.appendEvent({
    ev: "fact.added",
    type: "remember",
    source: "mcp",
    at,
    fact: {
      id: "fa_new1",
      claim: "new fact about testing",
      scope: "project:nautli",
      status: "active",
    },
  }, { apply: false });

  // Supersede another
  store.appendEvent({
    ev: "fact.superseded",
    id: "fa_old1",
    at,
  }, { apply: false });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  assert.ok(card, "card should exist");
  assert.equal(card.delta.added.length, 1);
  assert.equal(card.delta.added[0].claim, "new fact about testing");
  assert.equal(card.delta.replaced.length, 1);
});

test("card is null when events are outside the window", (t) => {
  const { home, store } = isolatedStore(t);
  // Event from 3 days ago (outside 1-day window)
  store.appendRecall({
    hits: ["fa_old"],
    session_id: "session-old",
    returned_chars: 50,
    at: "2026-07-15T08:00:00.000Z",
  });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  assert.equal(card, null);
});

test("card skips emission when only last_activity exists but no deliveries or delta", (t) => {
  const { home, store } = isolatedStore(t);
  // A recall with no hits (e.g. empty recall)
  store.appendRecall({
    hits: [],
    session_id: "session-nohit",
    returned_chars: 0,
    at: "2026-07-18T10:00:00.000Z",
  });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  // No delivery, no delta → card is null (skip emission per spec)
  assert.equal(card, null);
});

// ── Causal language guard ──────────────────────────────────────────────

test("assertNoCausalLanguage passes for observational text", () => {
  assert.doesNotThrow(() => assertNoCausalLanguage("기억을 건넸다"));
  assert.doesNotThrow(() => assertNoCausalLanguage("Memory delivered across 3 sessions"));
  assert.doesNotThrow(() => assertNoCausalLanguage("전달됐다"));
});

test("assertNoCausalLanguage throws for causal Korean text", () => {
  assert.throws(() => assertNoCausalLanguage("토큰을 아꼈다"), /Causal language/u);
  assert.throws(() => assertNoCausalLanguage("재설명을 면했다"), /Causal language/u);
  assert.throws(() => assertNoCausalLanguage("비용을 절감했다"), /Causal language/u);
  assert.throws(() => assertNoCausalLanguage("절감률 50%"), /Causal language/u);
  assert.throws(() => assertNoCausalLanguage("토큰 절약했다"), /Causal language/u);
});

test("assertNoCausalLanguage throws for causal English text", () => {
  assert.throws(() => assertNoCausalLanguage("saved 50 tokens"), /Causal language/u);
  assert.throws(() => assertNoCausalLanguage("Total savings: 120"), /Causal language/u);
  assert.throws(() => assertNoCausalLanguage("avoided re-explanation"), /Causal language/u);
  assert.throws(() => assertNoCausalLanguage("reduced token usage"), /Causal language/u);
});

// ── Savings percentage gate ────────────────────────────────────────────

test("savingsPercentage throws without experiment flag", () => {
  assert.throws(
    () => savingsPercentage(100, 1000),
    /experiment sample is not ready/u,
  );
  assert.throws(
    () => savingsPercentage(100, 1000, { experimentSampleReady: false }),
    /experiment sample is not ready/u,
  );
});

test("savingsPercentage returns value when experiment flag is set", () => {
  assert.equal(
    savingsPercentage(100, 1000, { experimentSampleReady: true }),
    10,
  );
  assert.equal(
    savingsPercentage(950, 1000, { experimentSampleReady: true }),
    95,
  );
});

test("savingsPercentage returns null for invalid inputs even with flag", () => {
  assert.equal(
    savingsPercentage(100, 0, { experimentSampleReady: true }),
    null,
  );
});

// ── Render ──────────────────────────────────────────────────────────────

test("renderHandoffCard returns null for null card", () => {
  const t = makeT("ko");
  assert.equal(renderHandoffCard(null, t), null);
});

test("renderHandoffCard produces observational text without causal language", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T08:00:00.000Z";
  const factData = makeFact({ claim: "test memory for render", scope: "project:test" });
  store.addFact(factData);
  const factId = factData.id;
  store.appendRecall({
    hits: [factId],
    session_id: "sess-render",
    returned_chars: 200,
    at,
  });
  store.appendEvent({
    ev: "fact.added",
    type: "remember",
    source: "mcp",
    at,
    fact: { id: "fa_render_new", claim: "new render fact", scope: "project:test", status: "active" },
  }, { apply: false });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  const koText = renderHandoffCard(card, makeT("ko"));
  const enText = renderHandoffCard(card, makeT("en"));

  // Both languages should pass the causal guard (it runs inside renderHandoffCard)
  assert.ok(koText.includes("인수인계"), "Korean should have handoff heading");
  assert.ok(enText.includes("handoff"), "English should have handoff heading");

  // Double-check: no banned patterns
  for (const pattern of CAUSAL_BANNED_PATTERNS) {
    assert.doesNotMatch(koText, pattern, `Korean output should not match ${pattern}`);
    assert.doesNotMatch(enText, pattern, `English output should not match ${pattern}`);
  }
});

// ── i18n strings safety ────────────────────────────────────────────────

test("all handoff i18n strings pass causal language guard", () => {
  for (const locale of ["ko", "en"]) {
    const t = makeT(locale);
    const keys = [
      "report.handoff_heading",
      "report.handoff_empty",
      "report.handoff_delta_heading",
      "report.handoff_tokens",
    ];
    for (const key of keys) {
      const text = t(key, { claim: "test", sessions: 1, scope: "test", at: "now", tokens: 100, old: "x", new: "y", count: 1 });
      assert.doesNotThrow(
        () => assertNoCausalLanguage(text),
        `i18n key "${key}" (${locale}) should pass causal guard`,
      );
    }
  }
});
