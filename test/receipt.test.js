import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReceipt, buildReceiptMulti } from "../src/core/receipt.js";
import { Store } from "../src/core/store.js";
import { makeT } from "../src/i18n/strings.js";
import { receiptHeader } from "../src/mcp/server.js";

const NOW = "2026-07-17T12:00:00.000Z";

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-receipt-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

test("empty receipt treats the store as having no activity", (t) => {
  const { home, store } = isolatedStore(t);
  const receipt = buildReceipt(home, store, { now: NOW });

  assert.equal(receipt.activity, 0);
  assert.equal(receipt.conversations, 0);
  assert.equal(receipt.tokens_delivered, 0);
  assert.equal(receipt.organized, 0);
  assert.equal(receipt.facts_active, 0);
  assert.equal(receipt.corpus_tokens, 0);
  assert.equal(receipt.sample_ok, false);
});

test("corpus tokens fall back to zero when a mock store has no database", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-receipt-mock-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const store = { stats: () => ({ byStatus: { active: 2 } }) };

  const receipt = buildReceipt(home, store, { now: NOW });

  assert.equal(receipt.corpus_tokens, 0);
});

test("recall events count distinct conversations without counting retries twice", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-16T10:02:00.000Z";
  store.appendRecall({ hits: ["fa_a"], session_id: "session-a", returned_chars: 40, at });
  store.appendRecall({ hits: ["fa_a"], session_id: "session-a", returned_chars: 20, at });
  store.appendRecall({ hits: ["fa_b"], session_id: "session-b", returned_chars: 12, at });
  store.appendRecall({ hits: ["fa_c"], scope: "person", returned_chars: 8, at });

  const receipt = buildReceipt(home, store, { now: NOW });

  assert.equal(receipt.conversations, 3);
  assert.equal(receipt.tokens_delivered, 20);
  assert.equal(receipt.approx, true);
  assert.equal(receipt.method, "chars_div4");
});

test("two conversations do not pass the sample gate", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 4,
    at: "2026-07-15T10:00:00.000Z",
  });
  store.appendRecall({
    hits: ["fa_b"],
    session_id: "session-b",
    returned_chars: 4,
    at: "2026-07-16T10:00:00.000Z",
  });

  assert.equal(buildReceipt(home, store, { now: NOW }).sample_ok, false);
});

test("weekly fact change keeps a negative value", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendEvent({
    ev: "fact.invalidated",
    id: "fa_old_a",
    at: "2026-07-15T10:00:00.000Z",
  }, { apply: false });
  store.appendEvent({
    ev: "fact.superseded",
    id: "fa_old_b",
    at: "2026-07-16T10:00:00.000Z",
  }, { apply: false });

  assert.equal(buildReceipt(home, store, { now: NOW }).facts_delta, -2);
});

test("receipt includes recent superseded claim pairs as corrected examples", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-receipt-corrections-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, "events"), { recursive: true });
  fs.appendFileSync(path.join(home, "events", "2026-07.jsonl"), `${JSON.stringify({
    ev: "fact.superseded",
    id: "fa_old",
    patch: { superseded_by: "fa_new" },
    at: "2026-07-16T10:00:00.000Z",
  })}\n`);
  const facts = new Map([
    ["fa_old", { claim: "배포일은 목요일이에요." }],
    ["fa_new", { claim: "배포일은 금요일이에요." }],
  ]);
  const store = {
    stats: () => ({ byStatus: { active: 1 } }),
    getFact: (id) => facts.get(id) ?? null,
  };

  const receipt = buildReceipt(home, store, { now: NOW });

  assert.deepEqual(receipt.corrected_examples, [{
    at: "2026-07-16T10:00:00.000Z",
    old_claim: "배포일은 목요일이에요.",
    new_claim: "배포일은 금요일이에요.",
  }]);
});

test("buildReceiptMulti returns four windows with lifetime flag and milestone", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-09T10:00:00.000Z",
  });

  const multi = buildReceiptMulti(home, store, { now: NOW });

  assert.deepEqual(Object.keys(multi.windows).sort(), ["2d", "30d", "7d", "lifetime"]);
  assert.equal(multi.windows.lifetime.is_lifetime, true);
  assert.equal(multi.windows["2d"].days, 2);
  assert.ok(multi.installed_at !== undefined);
  // 설치 직후(기억 나이 < 7일)면 아직 도달한 챔버가 없거나 첫 방이어야 한다
  if (multi.memory_age_days != null && multi.memory_age_days < 7) {
    assert.equal(multi.milestone, null);
  }
  if (multi.milestone) assert.ok(multi.memory_age_days >= multi.milestone.days);
});

test("lifetime window uses install date so memory_age_days matches lifetime.days", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-10T12:00:00.000Z",
  });

  const multi = buildReceiptMulti(home, store, { now: NOW });

  assert.equal(multi.memory_age_days, multi.windows.lifetime.days);
  assert.equal(multi.windows.lifetime.memory_age_days, multi.memory_age_days);
});

test("receipt evidence lists recent recalls with hit counts, newest first, capped at 3", (t) => {
  const { home, store } = isolatedStore(t);
  for (let i = 1; i <= 4; i++) {
    store.appendRecall({
      hits: ["fa_a", "fa_b"],
      session_id: `session-${i}`,
      returned_chars: 8,
      at: `2026-07-1${i}T10:00:00.000Z`,
    });
  }

  const receipt = buildReceipt(home, store, { now: NOW });

  assert.equal(receipt.evidence.length, 3);
  assert.equal(receipt.evidence[0].at, "2026-07-14T10:00:00.000Z");
  assert.equal(receipt.evidence[0].hits, 2);
});

test("receipt wording contains no long dash characters", () => {
  const receipt = {
    activity: 3,
    sample_ok: true,
    days: 7,
    conversations: 3,
    tokens_delivered: 120,
    facts_active: 4,
  };
  const messages = [
    receiptHeader(receipt, makeT("ko")),
    receiptHeader(receipt, makeT("en")),
  ];

  for (const message of messages) assert.doesNotMatch(message, /[—–]/u);
});
