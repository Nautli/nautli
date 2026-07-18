import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { remember } from "../src/core/gate.js";
import { applyCard, listCards, listSurfacedCards, listUndoLedger, migratePendingToAutoApply, recordAutoApply, undoAutoApply, undoStats } from "../src/core/review.js";
import { STATUS } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";

const config = { default_scope: "person" };

function fixture(t, verdict = "duplicate") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-review-"));
  const previous = process.env.NAUTLI_HOME;
  process.env.NAUTLI_HOME = home;
  const store = new Store(home);
  const oldFact = remember(store, {
    claim: verdict === "duplicate" ? "검토할 같은 메모의 옛 표현" : "서비스 포트는 3000이다",
    scope: "project:review",
    t_valid: "2025-01-01",
  }, config);
  const newFact = remember(store, {
    claim: verdict === "duplicate" ? "검토할 같은 메모의 새 표현" : "서비스 포트는 4000이다",
    scope: "project:review",
    t_valid: "2025-02-01",
  }, config);
  const pairId = `${oldFact.id}:${newFact.id}`;
  fs.writeFileSync(path.join(home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: pairId,
    verdict,
    confidence: 0.8,
    claims: {
      a: store.getFact(oldFact.id).claim,
      b: store.getFact(newFact.id).claim,
    },
    status: "pending",
  })}\n`, "utf8");
  t.after(() => {
    store.close();
    if (previous === undefined) delete process.env.NAUTLI_HOME;
    else process.env.NAUTLI_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store, oldFact, newFact, pairId };
}

test("merge supersedes the older fact and pair handling is idempotent", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t);
  assert.equal(listCards(home).length, 1);
  assert.equal(applyCard(store, home, pairId, "merge").ok, true);
  assert.equal(store.getFact(oldFact.id).status, STATUS.SUPERSEDED);
  assert.equal(store.getFact(oldFact.id).superseded_by, newFact.id);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
  assert.deepEqual(applyCard(store, home, pairId, "merge"), { ok: false, reason: "already_handled" });
  assert.equal(listCards(home).length, 0);
  assert.equal(fs.readdirSync(path.join(home, "review")).some((file) => file.includes(".tmp-")), false);
});

test("contradiction actions invalidate only the losing fact", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t, "contradiction");
  applyCard(store, home, pairId, "older_wins");
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.INVALIDATED);
});

test("a_wins invalidates the second fact in pair_id", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t, "contradiction");
  applyCard(store, home, pairId, "a_wins");
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.INVALIDATED);
  assert.equal(store.getFact(newFact.id).t_invalid, store.getFact(oldFact.id).t_valid);
});

test("b_wins invalidates the first fact in pair_id", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t, "contradiction");
  applyCard(store, home, pairId, "b_wins");
  assert.equal(store.getFact(oldFact.id).status, STATUS.INVALIDATED);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(oldFact.id).t_invalid, store.getFact(newFact.id).t_valid);
});

test("unknown dismisses the card without transitioning either fact", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t, "contradiction");
  let transitions = 0;
  const transition = store.transition.bind(store);
  store.transition = (...args) => {
    transitions += 1;
    return transition(...args);
  };

  const result = applyCard(store, home, pairId, "unknown");

  assert.deepEqual(result, {
    ok: true,
    status: "dismissed",
    action: "unknown",
    remembered: undefined,
  });
  assert.equal(transitions, 0);
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
});

test("report_issue dismisses without touching facts and logs the report", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t, "duplicate");

  assert.throws(() => applyCard(store, home, pairId, "report_issue"));
  assert.throws(() => applyCard(store, home, pairId, "report_issue", "  "));

  const result = applyCard(store, home, pairId, "report_issue", "나와 관련 없는 내용이에요");
  assert.equal(result.ok, true);
  assert.equal(result.status, "dismissed");
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);

  const reports = fs.readFileSync(path.join(home, "review", "issue-reports.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].pair_id, pairId);
  assert.equal(reports[0].text, "나와 관련 없는 내용이에요");
  assert.equal(reports[0].verdict, "duplicate");
});

test("unknown cards no longer appear in listCards", (t) => {
  const { home, store, pairId } = fixture(t, "contradiction");
  applyCard(store, home, pairId, "unknown");
  assert.equal(listCards(home).length, 0);
});

test("other answer stores a scoped correction and answers the card", (t) => {
  const { home, store, pairId } = fixture(t, "contradiction");
  const result = applyCard(store, home, pairId, "other", "서비스 포트는 환경별로 다르다");
  const correction = store.getFact(result.remembered.id);
  assert.equal(correction.scope, "project:review");
  assert.equal(correction.confidence, 0.9);
  assert.equal(correction.provenance.source, "review-card");
  assert.equal(listCards(home).length, 0);
});

test("other gate rejection leaves the card pending", (t) => {
  const { home, store, oldFact, pairId } = fixture(t, "contradiction");
  assert.throws(
    () => applyCard(store, home, pairId, "other", store.getFact(oldFact.id).claim),
    (error) => error.code === "W_DUPLICATE",
  );
  assert.equal(listCards(home).length, 1);
  const queued = JSON.parse(fs.readFileSync(path.join(home, "review", "queue.jsonl"), "utf8").trim());
  assert.equal(queued.status, "pending");
});

test("fact transition failure never completes the queue entry", (t) => {
  const { home, store, pairId } = fixture(t);
  store.transition = () => {
    throw new Error("injected transition failure");
  };
  assert.throws(() => applyCard(store, home, pairId, "merge"), /injected transition failure/);
  assert.equal(listCards(home).length, 1);
});

test("two colliding card applications produce one completion", async (t) => {
  const { home, pairId } = fixture(t);
  const gate = new SharedArrayBuffer(4);
  const workerUrl = new URL("./fixtures/apply-card-worker.js", import.meta.url);
  const workers = [0, 1].map(() => new Worker(workerUrl, { workerData: { home, pairId, gate } }));
  t.after(() => Promise.all(workers.map((worker) => worker.terminate())));
  const outcomes = workers.map((worker) => new Promise((resolve, reject) => {
    worker.on("error", reject);
    worker.on("message", (message) => {
      if (message.ready) return;
      if (message.error) reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else resolve(message.result);
    });
  }));
  await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", resolve);
  })));
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0, workers.length);
  const results = await Promise.all(outcomes);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.reason === "already_handled").length, 1);
  assert.equal(listCards(home).length, 0);
});

test("keep, defer, and both-valid only update queue status", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t);
  applyCard(store, home, pairId, "keep_separate");
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);
  assert.equal(listCards(home).length, 0);
});

test("a stale review lock is reclaimed after sixty seconds", (t) => {
  const { home } = fixture(t);
  const lock = path.join(home, "review", ".lock");
  fs.mkdirSync(lock);
  const stale = new Date(Date.now() - 61_000);
  fs.utimesSync(lock, stale, stale);
  assert.equal(listCards(home).length, 1);
  assert.equal(fs.existsSync(lock), false);
});

function capHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-cap-"));
  fs.mkdirSync(path.join(home, "review"), { recursive: true });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function writeCapQueue(home, entries) {
  fs.writeFileSync(
    path.join(home, "review", "queue.jsonl"),
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}

function readCapQueue(home) {
  return fs.readFileSync(path.join(home, "review", "queue.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
}

test("daily surfacing cap limits cards to 3 per day", (t) => {
  const home = capHome(t);
  const entries = Array.from({ length: 7 }, (_, index) => ({
    pair_id: `capture-${index + 1}`,
    type: "capture",
    claim: `기억 후보 ${index + 1}`,
    crux_plain: "질문",
    status: "pending",
    at: `2026-07-${String(index + 10).padStart(2, "0")}T09:00:00.000Z`,
  }));
  writeCapQueue(home, entries);
  const day1 = new Date("2026-07-18T09:00:00");

  const first = listSurfacedCards(home, { now: day1 });
  assert.deepEqual(first.cards.map((entry) => entry.pair_id), [
    "capture-1",
    "capture-2",
    "capture-3",
  ]);
  assert.equal(first.backlog, 4);

  const repeated = listSurfacedCards(home, { now: day1 });
  assert.deepEqual(repeated.cards.map((entry) => entry.pair_id), [
    "capture-1",
    "capture-2",
    "capture-3",
  ]);
  assert.equal(repeated.backlog, 4);
  assert.equal(readCapQueue(home).filter((entry) => entry.surfaced_at).length, 3);
  assert.equal(listCards(home).length, 7);
});

test("answering does not free same-day slots", (t) => {
  const home = capHome(t);
  const entries = Array.from({ length: 7 }, (_, index) => ({
    pair_id: `capture-${index + 1}`,
    type: "capture",
    claim: `기억 후보 ${index + 1}`,
    crux_plain: "질문",
    status: "pending",
    at: `2026-07-${String(index + 10).padStart(2, "0")}T09:00:00.000Z`,
  }));
  writeCapQueue(home, entries);
  const day1 = new Date("2026-07-18T09:00:00");
  listSurfacedCards(home, { now: day1 });
  const queued = readCapQueue(home);
  queued.find((entry) => entry.surfaced_at).status = "answered";
  writeCapQueue(home, queued);

  const sameDay = listSurfacedCards(home, { now: day1 });
  assert.equal(sameDay.cards.length, 2);
  assert.equal(readCapQueue(home).filter((entry) => entry.surfaced_at).length, 3);

  const day2 = new Date("2026-07-19T09:00:00");
  const nextDay = listSurfacedCards(home, { now: day2 });
  assert.equal(nextDay.cards.length, 3);
  assert.equal(readCapQueue(home).filter((entry) => entry.surfaced_at).length, 4);
});

test("pair cards surface before capture cards", (t) => {
  const home = capHome(t);
  writeCapQueue(home, [
    {
      pair_id: "capture-1",
      type: "capture",
      claim: "기억 후보",
      crux_plain: "질문",
      status: "pending",
      at: "2026-07-10T09:00:00.000Z",
    },
    {
      pair_id: "pair-1",
      verdict: "contradiction",
      claims: { a: "서비스 포트는 3000이다", b: "서비스 포트는 4000이다" },
      status: "pending",
    },
  ]);
  const day1 = new Date("2026-07-18T09:00:00");

  const surfaced = listSurfacedCards(home, { cap: 1, now: day1 });
  assert.equal(surfaced.cards[0].pair_id, "pair-1");
  assert.notEqual(surfaced.cards[0].type, "capture");
});

test("answering does not reopen slots across the UTC date boundary", (t) => {
  // KST처럼 UTC보다 앞선 타임존의 오전엔 로컬 날짜와 UTC 날짜가 다르다 —
  // surfaced_at(UTC ISO)을 문자열 비교하면 당일 노출을 놓쳐 캡이 재개방된다.
  const home = capHome(t);
  const entries = Array.from({ length: 5 }, (_, index) => ({
    pair_id: `capture-${index + 1}`,
    type: "capture",
    claim: `기억 후보 ${index + 1}`,
    crux_plain: "질문",
    status: "pending",
    at: `2026-07-${String(index + 10).padStart(2, "0")}T09:00:00.000Z`,
  }));
  writeCapQueue(home, entries);
  const morning = new Date("2026-07-18T08:00:00");
  listSurfacedCards(home, { now: morning });

  const queued = readCapQueue(home);
  for (const entry of queued) {
    if (entry.surfaced_at) entry.status = "answered";
  }
  writeCapQueue(home, queued);

  const later = new Date("2026-07-18T09:00:00");
  const afterAnswering = listSurfacedCards(home, { now: later });
  assert.equal(afterAnswering.cards.length, 0);
  assert.equal(readCapQueue(home).filter((entry) => entry.surfaced_at).length, 3);
});

test("deferred cards lose surfaced_at on restore and respect the cap", (t) => {
  const home = capHome(t);
  const entries = Array.from({ length: 5 }, (_, index) => ({
    pair_id: `capture-${index + 1}`,
    type: "capture",
    claim: `기억 후보 ${index + 1}`,
    crux_plain: "질문",
    status: "pending",
    at: `2026-07-${String(index + 10).padStart(2, "0")}T09:00:00.000Z`,
  }));
  writeCapQueue(home, entries);
  const day1 = new Date("2026-07-18T09:00:00");
  listSurfacedCards(home, { now: day1 });

  // 노출된 카드 하나를 이틀 뒤로 미룬다 (surfaced_at은 남은 상태).
  const queued = readCapQueue(home);
  const deferred = queued.find((entry) => entry.surfaced_at);
  deferred.status = "deferred";
  deferred.deferred_until = "2026-07-20";
  writeCapQueue(home, queued);

  // 다음날 새 카드가 그 자리를 채운다.
  const day2 = new Date("2026-07-19T09:00:00");
  assert.equal(listSurfacedCards(home, { now: day2 }).cards.length, 3);

  // 복원일: surfaced_at이 벗겨져 후보줄로 돌아가고, 노출은 여전히 cap 이하다.
  const day3 = new Date("2026-07-20T09:00:00");
  const restoredDay = listSurfacedCards(home, { now: day3 });
  assert.equal(restoredDay.cards.length <= 3, true);
  const restoredEntry = readCapQueue(home)
    .find((entry) => entry.pair_id === deferred.pair_id);
  assert.equal(restoredEntry.status, "pending");
});

// --- Undo ledger tests ---

test("recordAutoApply creates undo ledger entry", (t) => {
  const home = capHome(t);
  const entry = recordAutoApply(home, {
    pair_id: "fa_old:fa_new",
    action: "merge",
    verdict: "duplicate",
    confidence: 0.95,
    scope: "project:test",
    before_state: [{ id: "fa_old", status: "active", claim: "old" }],
    fact_ids: ["fa_old", "fa_new"],
    claim_a: "old claim",
    claim_b: "new claim",
    type: "pair",
  });
  assert.ok(entry.undo_id);
  assert.equal(entry.action, "merge");
  assert.equal(entry.undone, false);

  const ledger = listUndoLedger(home);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].undo_id, entry.undo_id);
});

test("undoAutoApply reverses a merge by restoring superseded fact", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t);
  // Manually merge
  applyCard(store, home, pairId, "merge");
  assert.equal(store.getFact(oldFact.id).status, STATUS.SUPERSEDED);

  // Record the auto-apply
  const entry = recordAutoApply(home, {
    pair_id: pairId,
    action: "merge",
    verdict: "duplicate",
    confidence: 0.95,
    scope: "project:review",
    before_state: [{ id: oldFact.id, status: "active", claim: "old" }],
    fact_ids: [oldFact.id, newFact.id],
    type: "pair",
  });

  // Undo it
  const result = undoAutoApply(store, home, entry.undo_id);
  assert.equal(result.ok, true);
  assert.equal(result.reversed_action, "merge");

  // Fact should be restored to ACTIVE
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);

  // Undo is idempotent
  const result2 = undoAutoApply(store, home, entry.undo_id);
  assert.equal(result2.ok, false);
  assert.equal(result2.reason, "already_undone");
});

test("undoAutoApply reverses a remember by archiving the fact", (t) => {
  const home = capHome(t);
  const store = new Store(home);
  t.after(() => store.close());

  const remembered = remember(store, {
    claim: "test auto-remembered fact",
    scope: "project:test",
  }, { default_scope: "project:test" });
  assert.equal(store.getFact(remembered.id).status, STATUS.ACTIVE);

  const entry = recordAutoApply(home, {
    pair_id: "cap:test",
    action: "remember",
    fact_id: remembered.id,
    claim: "test auto-remembered fact",
    type: "capture",
  });

  const result = undoAutoApply(store, home, entry.undo_id);
  assert.equal(result.ok, true);
  assert.equal(store.getFact(remembered.id).status, STATUS.ARCHIVED);
});

test("undoStats tracks total and undo counts", (t) => {
  const home = capHome(t);
  const store = new Store(home);
  t.after(() => store.close());

  assert.deepEqual(undoStats(home), { total: 0, undone: 0, undo_rate: 0 });

  const entry1 = recordAutoApply(home, {
    pair_id: "pair1",
    action: "merge",
    type: "pair",
  });
  recordAutoApply(home, {
    pair_id: "pair2",
    action: "shadow",
    type: "pair",
  });

  assert.equal(undoStats(home).total, 2);
  assert.equal(undoStats(home).undone, 0);

  undoAutoApply(store, home, entry1.undo_id);
  assert.equal(undoStats(home).undone, 1);
  assert.equal(undoStats(home).undo_rate, 0.5);
});

test("migratePendingToAutoApply processes pending cards", (t) => {
  const { home, store, oldFact, newFact, pairId } = fixture(t);
  // The fixture creates a pending duplicate card with conf 0.8
  // Since conf < 0.9, it should be shadowed, not merged
  const result = migratePendingToAutoApply(store, home);
  assert.equal(result.migrated, 1);

  const ledger = listUndoLedger(home);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].action, "shadow");

  // Both facts should still be active (shadow doesn't apply)
  assert.equal(store.getFact(oldFact.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(newFact.id).status, STATUS.ACTIVE);

  // No more pending cards
  assert.equal(listCards(home).length, 0);
});

test("undoAutoApply rejects unknown undo_id", (t) => {
  const home = capHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  assert.throws(() => undoAutoApply(store, home, "nonexistent"), (error) => error.code === "E_NOT_FOUND");
});
