import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReceipt, buildReceiptMulti, localWeekStart } from "../src/core/receipt.js";
import { Store, readEventLog } from "../src/core/store.js";
import { auditDelivery } from "../src/core/audit.js";
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

// TASK-BATCH-FIX (F-7): the receipt must read through the ev_id first-wins logical reader so a
// duplicated recall line (same ev_id) does not double-count tokens/conversations versus audit.
test("duplicated recall ev_id counts once and matches audit delivery count", (t) => {
  const { home, store } = isolatedStore(t);
  const at = "2026-07-16T10:00:00.000Z";
  store.addFact({
    id: "fa_receipt_dup",
    type: "semantic",
    scope: "person",
    subject: "",
    claim: "receipt dedup delivered fact",
    confidence: 0.9,
    provenance: {},
    t_valid: "2026-07-16",
    t_invalid: null,
    t_expired: null,
    superseded_by: null,
    status: "active",
    claim_hash: "h_receipt_dup",
  });
  store.appendRecall({ hits: ["fa_receipt_dup"], session_id: "sess-r", returned_chars: 40, at });

  // Duplicate the recall line verbatim (same ev_id).
  const recall = readEventLog(home).find((e) => e.type === "recall" && Array.isArray(e.hits));
  fs.appendFileSync(path.join(home, "events", `${at.slice(0, 7)}.jsonl`), `${JSON.stringify(recall)}\n`);
  assert.equal(readEventLog(home).filter((e) => e.type === "recall").length, 2, "two raw lines exist");

  const receipt = buildReceipt(home, store, { now: NOW });
  // 40 chars / 4 = 10 tokens, counted once (not 20); one conversation, not two.
  assert.equal(receipt.tokens_delivered, 10);
  assert.equal(receipt.conversations, 1);
  assert.equal(auditDelivery(home, "fa_receipt_dup").deliveries.length, 1, "audit also counts one delivery");
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

// TASK-075: 숫자별 근거 드릴다운 — recall/organized/active 세 묶음, 각 최대 3건.
test("receipt evidence groups split recall, organized, and active, each capped at 3", (t) => {
  const { home, store } = isolatedStore(t);
  for (let i = 1; i <= 4; i++) {
    store.addFact({
      id: `fa_active_${i}`,
      type: "semantic",
      scope: "person",
      subject: "",
      claim: `active memory ${i}`,
      confidence: 0.9,
      provenance: {},
      t_valid: `2026-07-0${i}`,
      t_invalid: null,
      t_expired: null,
      superseded_by: null,
      status: "active",
      claim_hash: `h_active_${i}`,
    });
    store.appendRecall({
      hits: [`fa_active_${i}`],
      session_id: `session-${i}`,
      returned_chars: 8,
      at: `2026-07-1${i}T10:00:00.000Z`,
    });
  }
  const queue = path.join(home, "review", "queue.jsonl");
  for (let i = 1; i <= 4; i++) {
    fs.appendFileSync(queue, `${JSON.stringify({
      pair_id: `pair-${i}`,
      status: "answered",
      answered_by: "user",
      handled_at: `2026-07-1${i}T11:00:00.000Z`,
    })}\n`);
  }

  const receipt = buildReceipt(home, store, { now: NOW });
  const groups = receipt.evidence_groups;

  assert.deepEqual(Object.keys(groups).sort(), ["active", "organized", "recall"]);
  assert.equal(groups.recall.length, 3);
  assert.equal(groups.recall[0].at, "2026-07-14T10:00:00.000Z");
  assert.equal(groups.organized.length, 3);
  assert.equal(groups.organized[0].at, "2026-07-14T11:00:00.000Z");
  assert.equal(groups.organized[0].actor, "user");
  assert.equal(groups.active.length, 3);
  assert.ok(typeof groups.active[0].sample_claim === "string");
});

// TASK-075: 로컬 주 스냅샷이 있으면 active-start를 정확히 알아 approximate=false.
test("buildReceiptMulti uses an exact week snapshot for active-start", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-15T10:00:00.000Z",
  });
  const weekStartIso = new Date(localWeekStart(Date.parse(NOW))).toISOString();
  fs.mkdirSync(path.join(home, "receipt"), { recursive: true });
  fs.writeFileSync(path.join(home, "receipt", "week-snapshot.json"), `${JSON.stringify({
    schema: 1,
    week_start: weekStartIso,
    facts_active_at_start: 42,
  })}\n`);

  const multi = buildReceiptMulti(home, store, { now: NOW });

  assert.equal(multi.active_start_approximate, false);
  assert.equal(multi.windows["7d"].facts_active_at_start, 42);
  assert.equal(multi.windows["7d"].facts_active_at_start_approximate, false);
});

// TASK-075: 스냅샷이 없으면 approximate=true(델타 폴백)이고, 다음 주부터 쓰도록 베이스라인을 심는다.
test("buildReceiptMulti flags active-start approximate and seeds a snapshot when absent", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-15T10:00:00.000Z",
  });
  const snapFile = path.join(home, "receipt", "week-snapshot.json");
  assert.equal(fs.existsSync(snapFile), false);

  const multi = buildReceiptMulti(home, store, { now: NOW });

  assert.equal(multi.active_start_approximate, true);
  assert.equal(multi.windows["7d"].facts_active_at_start_approximate, true);
  assert.equal(fs.existsSync(snapFile), true);
  const snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
  assert.equal(snap.week_start, new Date(localWeekStart(Date.parse(NOW))).toISOString());
});

// TASK-075: 월 이벤트 파일 3개 이상이면 요약을 캐시하고, 파일 mtime이 바뀌면 캐시가 깨진다.
test("buildReceiptMulti caches with 3+ monthly files and busts on mtime change", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-15T10:00:00.000Z",
  });
  const evDir = path.join(home, "events");
  for (const month of ["2026-05", "2026-06"]) {
    fs.writeFileSync(path.join(evDir, `${month}.jsonl`), `${JSON.stringify({
      type: "recall",
      hits: ["fa_a"],
      session_id: `session-${month}`,
      returned_chars: 8,
      at: `${month}-10T10:00:00.000Z`,
    })}\n`);
  }

  const first = buildReceiptMulti(home, store, { now: NOW });
  assert.equal(first.from_cache, false);
  assert.equal(fs.existsSync(path.join(home, "receipt", "summary-cache.json")), true);

  const second = buildReceiptMulti(home, store, { now: NOW });
  assert.equal(second.from_cache, true);
  assert.equal(second.windows["7d"].conversations, first.windows["7d"].conversations);

  // 정본 파일의 mtime을 바꾸면 캐시 키가 달라져 재계산해야 한다.
  const bumped = new Date(Date.parse(NOW) - 60_000);
  fs.utimesSync(path.join(evDir, "2026-06.jsonl"), bumped, bumped);

  const third = buildReceiptMulti(home, store, { now: NOW });
  assert.equal(third.from_cache, false);
});

// TASK-FIX-B45 (finding 1): 로컬 날짜가 넘어가면 파일이 그대로여도 캐시가 깨지고 재계산해야 한다.
test("buildReceiptMulti busts the summary cache on a local day rollover", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-15T10:00:00.000Z",
  });
  const evDir = path.join(home, "events");
  for (const month of ["2026-05", "2026-06"]) {
    fs.writeFileSync(path.join(evDir, `${month}.jsonl`), `${JSON.stringify({
      type: "recall",
      hits: ["fa_a"],
      session_id: `session-${month}`,
      returned_chars: 8,
      at: `${month}-10T10:00:00.000Z`,
    })}\n`);
  }

  const day1 = "2026-07-15T12:00:00.000Z";
  const day2 = "2026-07-16T12:00:00.000Z"; // +24h → always a different local calendar day.

  const first = buildReceiptMulti(home, store, { now: day1 });
  assert.equal(first.from_cache, false);

  const cachedSameDay = buildReceiptMulti(home, store, { now: day1 });
  assert.equal(cachedSameDay.from_cache, true, "same local day reuses the cache");

  // 아무 정본 파일도 안 바꿨지만 로컬 날짜가 넘어가면 윈도우 경계가 달라져 캐시 미스여야 한다.
  const nextDay = buildReceiptMulti(home, store, { now: day2 });
  assert.equal(nextDay.from_cache, false, "a new local day forces a recompute");
  assert.notEqual(
    nextDay.windows["2d"].since_at,
    first.windows["2d"].since_at,
    "the 2d window boundary advances with the new day",
  );
});

// TASK-FIX-B45 (finding 2, approximate branch): 주 시작 이후(수요일)에 잡힌 스냅샷은 근사다.
test("a week snapshot captured after week start stays approximate", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-15T10:00:00.000Z",
  });
  const weekStart = localWeekStart(Date.parse(NOW));
  const midWeek = new Date(weekStart + 2 * 86_400_000).toISOString(); // Wednesday
  fs.mkdirSync(path.join(home, "receipt"), { recursive: true });
  fs.writeFileSync(path.join(home, "receipt", "week-snapshot.json"), `${JSON.stringify({
    schema: 1,
    week_start: new Date(weekStart).toISOString(),
    facts_active_at_start: 42,
    captured_at: midWeek,
  })}\n`);

  const multi = buildReceiptMulti(home, store, { now: NOW });

  assert.equal(multi.active_start_approximate, true);
  assert.equal(multi.windows["7d"].facts_active_at_start_approximate, true);
  assert.notEqual(multi.windows["7d"].facts_active_at_start, 42, "the mid-week count is not trusted as the baseline");
});

// TASK-FIX-B45 (finding 2, exact branch): 주 시작-이하에 잡힌 스냅샷은 정확값(approximate=false).
test("a week snapshot captured at-or-before week start reports exact", (t) => {
  const { home, store } = isolatedStore(t);
  store.appendRecall({
    hits: ["fa_a"],
    session_id: "session-a",
    returned_chars: 40,
    at: "2026-07-15T10:00:00.000Z",
  });
  const weekStart = localWeekStart(Date.parse(NOW));
  const atStart = new Date(weekStart).toISOString(); // exactly Monday 00:00 local
  fs.mkdirSync(path.join(home, "receipt"), { recursive: true });
  fs.writeFileSync(path.join(home, "receipt", "week-snapshot.json"), `${JSON.stringify({
    schema: 1,
    week_start: atStart,
    facts_active_at_start: 42,
    captured_at: atStart,
  })}\n`);

  const multi = buildReceiptMulti(home, store, { now: NOW });

  assert.equal(multi.active_start_approximate, false);
  assert.equal(multi.windows["7d"].facts_active_at_start, 42);
  assert.equal(multi.windows["7d"].facts_active_at_start_approximate, false);
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
