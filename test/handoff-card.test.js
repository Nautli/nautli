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
import { Store, readEventLog } from "../src/core/store.js";
import { auditDelivery } from "../src/core/audit.js";
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

// TASK-BATCH-FIX (F-7): the handoff card must read through the ev_id first-wins logical reader so a
// duplicated recall line (same ev_id) does not double-count deliveries versus audit.
test("duplicated recall ev_id counts once and matches audit delivery count", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T08:00:00.000Z";
  const factData = makeFact({ claim: "handoff dedup delivered fact", scope: "project:nautli" });
  store.addFact(factData);
  store.appendRecall({ hits: [factData.id], session_id: "sess-dup", returned_chars: 100, at });

  // Duplicate the recall line verbatim (same ev_id) into the month file.
  const recall = readEventLog(home).find((e) => e.type === "recall" && Array.isArray(e.hits));
  const monthFile = path.join(home, "events", `${at.slice(0, 7)}.jsonl`);
  fs.appendFileSync(monthFile, `${JSON.stringify(recall)}\n`);
  assert.equal(readEventLog(home).filter((e) => e.type === "recall").length, 2, "two raw lines exist");

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  assert.equal(card.delivered.delivery_count, 1, "first-wins dedups the duplicated ev_id");
  assert.equal(
    card.delivered.delivery_count,
    auditDelivery(home, factData.id).deliveries.length,
    "handoff delivery count matches audit delivery count",
  );
});

// ── Baseline token measurement ─────────────────────────────────────────

test("tokens include baseline from active facts for comparison", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T08:00:00.000Z";
  // Add 3 facts (each ~30 chars claim)
  for (let i = 0; i < 3; i++) {
    store.addFact(makeFact({ claim: `fact number ${i} for baseline test` }));
  }
  // Recall that delivered 1 fact
  const factData = makeFact({ claim: "delivered fact for baseline" });
  store.addFact(factData);
  store.appendRecall({
    hits: [factData.id],
    session_id: "sess-base",
    returned_chars: 100,
    at,
  });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  assert.ok(card, "card should exist");
  assert.ok(card.tokens.baseline_tokens > 0, "baseline should be > 0 with active facts");
  assert.ok(card.tokens.baseline_tokens > card.tokens.injected_tokens,
    "baseline should exceed injected (all facts vs subset)");
});

test("tokens baseline is 0 when store is null", (t) => {
  const { home } = isolatedStore(t);
  const at = "2026-07-18T08:00:00.000Z";
  // Write a recall event manually to the events dir
  const eventsDir = path.join(home, "events");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventsDir, "2026-07.jsonl"),
    JSON.stringify({ type: "recall", hits: ["fa_x"], returned_chars: 40, at }) + "\n",
  );
  // Append a fact.added event too for delta
  fs.appendFileSync(
    path.join(eventsDir, "2026-07.jsonl"),
    JSON.stringify({ ev: "fact.added", at, fact: { id: "fa_x", claim: "test", status: "active" } }) + "\n",
  );

  const card = buildHandoffCard(home, null, { now: NOW, days: 1 });
  assert.ok(card, "card should exist");
  assert.equal(card.tokens.baseline_tokens, 0, "baseline 0 when no store");
});

test("renderHandoffCard includes baseline comparison when baseline > 0", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T08:00:00.000Z";
  // Add facts for baseline
  for (let i = 0; i < 5; i++) {
    store.addFact(makeFact({ claim: `a reasonably long fact claim number ${i} that contributes to baseline` }));
  }
  const factData = makeFact({ claim: "delivered for baseline render test" });
  store.addFact(factData);
  store.appendRecall({
    hits: [factData.id],
    session_id: "sess-baseline-render",
    returned_chars: 40,
    at,
  });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  const koText = renderHandoffCard(card, makeT("ko"));
  const enText = renderHandoffCard(card, makeT("en"));

  // Should contain baseline comparison language
  assert.ok(koText.includes("대비"), "Korean should include baseline comparison");
  assert.ok(enText.includes("baseline"), "English should include baseline comparison");
  assert.ok(koText.includes("경량"), "Korean should show percentage");
  assert.ok(enText.includes("lighter"), "English should show percentage");
});

test("block 4 is skipped when delta exists but no recall (injected_tokens=0)", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-18T09:00:00.000Z";
  // Only a fact.added event, no recall
  store.appendEvent({
    ev: "fact.added",
    type: "remember",
    source: "mcp",
    at,
    fact: { id: "fa_norecall", claim: "fact without recall", scope: "project:test", status: "active" },
  }, { apply: false });

  const card = buildHandoffCard(home, store, { now: NOW, days: 1 });
  assert.ok(card, "card should exist (delta present)");
  assert.equal(card.tokens.injected_tokens, 0, "no tokens injected");

  const koText = renderHandoffCard(card, makeT("ko"));
  // Block ④ should be absent (injected_tokens=0)
  assert.ok(!koText.includes("주입"), "Block 4 should be skipped when injected_tokens=0");
  // But delta block should be present
  assert.ok(koText.includes("fact without recall"), "delta block should render");
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
  const vars = {
    claim: "test", sessions: 1, scope: "test", at: "now",
    tokens: 100, old: "x", new: "y", count: 1,
    baseline_tokens: 5000, pct: 95,
  };
  for (const locale of ["ko", "en"]) {
    const t = makeT(locale);
    const keys = [
      "report.handoff_heading",
      "report.handoff_delivered",
      "report.handoff_last_activity",
      "report.handoff_delta_heading",
      "report.handoff_delta_added",
      "report.handoff_delta_replaced",
      "report.handoff_delta_more",
      "report.handoff_tokens",
      "report.handoff_tokens_baseline",
      "report.handoff_empty",
    ];
    for (const key of keys) {
      const text = t(key, vars);
      assert.doesNotThrow(
        () => assertNoCausalLanguage(text),
        `i18n key "${key}" (${locale}) should pass causal guard`,
      );
    }
  }
});
