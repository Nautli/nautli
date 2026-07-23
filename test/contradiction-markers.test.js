// TASK-037: 미해결 모순 가시화 + "몰라요" 14일 스누즈.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall, briefing } from "../src/core/recall.js";
import { appendCards, applyCard, listSurfacedCards } from "../src/core/review.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-conflict-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

function contradictingPair(store) {
  const a = remember(store, { claim: "배포 포트는 3000", scope: "project:alpha", confidence: 0.9 }, config);
  const b = remember(store, { claim: "배포 포트는 4000", scope: "project:alpha", confidence: 0.9 }, config);
  return { a, b, pairId: `${a.id}:${b.id}` };
}

function queueContradiction(home, { a, b, pairId }) {
  appendCards(home, [{
    pair_id: pairId,
    verdict: "contradiction",
    confidence: 0.7,
    newer: "b",
    status: "pending",
    source: "test",
    claims: { a: a.claim, b: b.claim },
  }]);
}

test("pending contradiction marks BOTH active facts in recall output", (t) => {
  const { home, store } = isolatedStore(t);
  const pair = contradictingPair(store);
  queueContradiction(home, pair);

  const result = recall(store, "포트", { scope: "project:alpha" });
  const fa = result.facts.find((fact) => fact.id === pair.a.id);
  const fb = result.facts.find((fact) => fact.id === pair.b.id);
  assert.deepEqual(fa.conflicts_with, [pair.b.id]);
  assert.deepEqual(fb.conflicts_with, [pair.a.id]);
  // 텍스트 출력에도 마커가 실린다
  assert.match(result.briefing, /미해결 충돌/u);
});

test("pending contradiction marks BOTH sides in briefing output too", (t) => {
  const { home, store } = isolatedStore(t);
  const pair = contradictingPair(store);
  queueContradiction(home, pair);

  const result = briefing(store, "포트", "project:alpha", config);
  assert.match(result.briefing, /미해결 충돌/u);
  const fa = result.facts.find((fact) => fact.id === pair.a.id);
  const fb = result.facts.find((fact) => fact.id === pair.b.id);
  assert.ok(fa.conflicts_with.includes(pair.b.id));
  assert.ok(fb.conflicts_with.includes(pair.a.id));
});

test("both_valid resolution clears the conflict markers", (t) => {
  const { home, store } = isolatedStore(t);
  const pair = contradictingPair(store);
  queueContradiction(home, pair);

  applyCard(store, home, pair.pairId, "both_valid");

  const result = recall(store, "포트", { scope: "project:alpha" });
  assert.equal(result.facts.find((fact) => fact.id === pair.a.id).conflicts_with, undefined);
  assert.equal(result.facts.find((fact) => fact.id === pair.b.id).conflicts_with, undefined);
  assert.doesNotMatch(result.briefing, /미해결 충돌/u);
});

test("resolving one side (a_wins) clears markers because both are no longer active", (t) => {
  const { home, store } = isolatedStore(t);
  const pair = contradictingPair(store);
  queueContradiction(home, pair);

  applyCard(store, home, pair.pairId, "a_wins");
  const result = recall(store, "포트", { scope: "project:alpha" });
  // b는 invalidated → recall에서 사라지고, a는 마커 없이 남는다
  const fa = result.facts.find((fact) => fact.id === pair.a.id);
  assert.ok(fa);
  assert.equal(fa.conflicts_with, undefined);
  assert.doesNotMatch(result.briefing, /미해결 충돌/u);
});

test("a deferred (snoozed) contradiction still carries markers", (t) => {
  const { home, store } = isolatedStore(t);
  const pair = contradictingPair(store);
  queueContradiction(home, pair);

  // "몰라요" → 14일 스누즈. 리뷰 카드는 숨겨지지만 충돌 마커는 계속 노출된다.
  const now = new Date();
  applyCard(store, home, pair.pairId, "unknown", undefined, { now });

  const result = recall(store, "포트", { scope: "project:alpha" });
  assert.deepEqual(result.facts.find((fact) => fact.id === pair.a.id).conflicts_with, [pair.b.id]);
  assert.match(result.briefing, /미해결 충돌/u);
});

test("몰라요 defers the review card 14 days and it resurfaces after expiry (clock-injectable)", (t) => {
  const { home, store } = isolatedStore(t);
  const pair = contradictingPair(store);
  queueContradiction(home, pair);

  const now = new Date();
  const result = applyCard(store, home, pair.pairId, "unknown", undefined, { now });
  assert.equal(result.status, "deferred");

  // 즉시 숨김
  assert.equal(listSurfacedCards(home, { now }).cards.length, 0);
  // 13일 후에도 여전히 숨김
  const day13 = new Date(now.getTime() + 13 * 86_400_000);
  assert.equal(listSurfacedCards(home, { now: day13 }).cards.length, 0);
  // 15일 후 재부상
  const day15 = new Date(now.getTime() + 15 * 86_400_000);
  const revived = listSurfacedCards(home, { now: day15 });
  assert.ok(revived.cards.some((card) => card.pair_id === pair.pairId));
});
