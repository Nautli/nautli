// TASK-013: 기억 그래프 v0 — related 엣지 저장 + recall 이웃 부스트.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall } from "../src/core/recall.js";
import { renderViews } from "../src/daemon/render.js";
import { applyJudgments } from "../src/daemon/apply.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-edges-"));
  let store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return {
    home,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(home);
      return store;
    },
  };
}

test("upsertEdge normalizes the id pair lexicographically", (t) => {
  const { store } = isolatedStore(t);
  const a = remember(store, { claim: "포트는 3000", scope: "project:alpha" }, config);
  const b = remember(store, { claim: "데이터베이스는 sqlite", scope: "project:alpha" }, config);
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];

  // 역순으로 넣어도 정규화되어 같은 행에 접힌다
  store.upsertEdge({ a_id: hi, b_id: lo, kind: "related", confidence: 0.9, source: "judge" });
  const edges = store.listEdges([a.id, b.id]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].a_id, lo);
  assert.equal(edges[0].b_id, hi);
  assert.equal(edges[0].confidence, 0.9);

  // 같은 쌍 재-upsert는 새 행을 만들지 않고 confidence만 갱신
  store.upsertEdge({ a_id: lo, b_id: hi, confidence: 0.5, source: "ingest" });
  const after = store.listEdges([a.id]);
  assert.equal(after.length, 1);
  assert.equal(after[0].confidence, 0.5);
  assert.equal(after[0].source, "ingest");
});

test("upsertEdge rejects self-loops and empty ids", (t) => {
  const { store } = isolatedStore(t);
  assert.throws(() => store.upsertEdge({ a_id: "fa_x", b_id: "fa_x" }));
  assert.throws(() => store.upsertEdge({ a_id: "", b_id: "fa_y" }));
});

test("recall boosts 1-hop ACTIVE neighbors at a lower rank than seeds", (t) => {
  const { store } = isolatedStore(t);
  // seed: FTS로 잡히는 fact
  const seed = remember(store, { claim: "배포 포트는 3000", scope: "project:alpha", confidence: 0.9 }, config);
  // neighbor: 질의어와 무관해 FTS로는 안 잡히지만 엣지로 연결됨
  const neighbor = remember(store, { claim: "회고 회의는 금요일", scope: "project:alpha", confidence: 0.9 }, config);
  store.upsertEdge({ a_id: seed.id, b_id: neighbor.id, kind: "related", confidence: 0.9, source: "judge" });

  const result = recall(store, "포트", { scope: "project:alpha" });
  const ids = result.facts.map((fact) => fact.id);
  assert.ok(ids.includes(seed.id), "seed present");
  assert.ok(ids.includes(neighbor.id), "neighbor boosted in");
  // seed가 neighbor보다 앞선다(더 높은 랭크)
  assert.ok(ids.indexOf(seed.id) < ids.indexOf(neighbor.id));
  // neighbor는 related_via로 어느 seed에서 왔는지 표기, seed는 표기 없음
  const neighborProj = result.facts.find((fact) => fact.id === neighbor.id);
  const seedProj = result.facts.find((fact) => fact.id === seed.id);
  assert.equal(neighborProj.related_via, seed.id);
  assert.equal(seedProj.related_via, undefined);
});

// TASK-FIX-B12 (M-4): the edge graph reflects NOW, not the as-of instant, so an
// as_of recall must skip neighbor expansion entirely for historical result purity.
// The neighbor here is only reachable via the edge (it is the oldest fact, so it falls
// outside the 30 most-recent facts the as_of path pulls in — isolating the edge path).
test("TASK-FIX-B12 as_of recall skips edge-neighbor expansion", (t) => {
  const { store } = isolatedStore(t);
  // Neighbor is the OLDEST fact and does not match the query — only the edge can reach it.
  const neighbor = remember(store, { claim: "회고 회의는 금요일", scope: "project:alpha", confidence: 0.9, t_valid: "2025-01-01" }, config);
  const seed = remember(store, { claim: "배포 포트는 3000", scope: "project:alpha", confidence: 0.9, t_valid: "2025-02-01" }, config);
  // 30 newer, non-matching facts push the neighbor out of the as_of "recents" window.
  for (let i = 0; i < 30; i += 1) {
    remember(store, { claim: `무관메모 ${i} 상세 항목`, scope: "project:alpha", confidence: 0.9, t_valid: "2025-03-01" }, config);
  }
  // Edge exists in the present graph (well after the as_of instant queried below).
  store.upsertEdge({ a_id: seed.id, b_id: neighbor.id, kind: "related", confidence: 0.9, source: "judge" });

  // Live recall boosts the neighbor in via the edge (tagged with edge provenance).
  const live = recall(store, "포트", { scope: "project:alpha" }).facts;
  const liveNeighbor = live.find((fact) => fact.id === neighbor.id);
  assert.ok(liveNeighbor, "neighbor boosted live via edge");
  assert.equal(liveNeighbor.related_via, seed.id);

  // as_of recall must NOT expand via the (present-day) edge graph.
  const past = recall(store, "포트", { scope: "project:alpha", as_of: "2025-06-01" }).facts;
  assert.ok(past.some((fact) => fact.id === seed.id), "seed still visible at as_of");
  assert.ok(!past.some((fact) => fact.id === neighbor.id), "neighbor must not be edge-expanded for as_of recall");
});

test("recall does not boost neighbors of a superseded (non-active) fact", (t) => {
  const { store } = isolatedStore(t);
  const seed = remember(store, { claim: "배포 포트는 3000", scope: "project:alpha", confidence: 0.9 }, config);
  const neighbor = remember(store, { claim: "회고 회의는 금요일", scope: "project:alpha", confidence: 0.9 }, config);
  store.upsertEdge({ a_id: seed.id, b_id: neighbor.id, confidence: 0.9, source: "judge" });
  // neighbor를 archive → activeNeighbors에서 제외되어야 한다
  store.transition(neighbor.id, "archived", {}, "daemon");

  const result = recall(store, "포트", { scope: "project:alpha" });
  const ids = result.facts.map((fact) => fact.id);
  assert.ok(ids.includes(seed.id));
  assert.ok(!ids.includes(neighbor.id));
});

test("nightly related verdict is persisted as an edge", (t) => {
  const { store, home } = isolatedStore(t);
  const a = remember(store, { claim: "포트는 3000", scope: "project:alpha", confidence: 0.9 }, config);
  const b = remember(store, { claim: "회고는 금요일", scope: "project:alpha", confidence: 0.9 }, config);
  const judgments = [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "related",
    confidence: 0.85,
    newer: null,
    reason: "같은 프로젝트 보완 관계",
  }];
  const results = applyJudgments(store, judgments, {});
  assert.equal(results.edges, 1);
  const edges = store.listEdges([a.id, b.id]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].kind, "related");
  assert.equal(edges[0].source, "judge");
  void home;
});

test("rebuild restores edges from the event log (derived table)", (t) => {
  const state = isolatedStore(t);
  const a = remember(state.store, { claim: "포트는 3000", scope: "project:alpha" }, config);
  const b = remember(state.store, { claim: "회고는 금요일", scope: "project:alpha" }, config);
  state.store.upsertEdge({ a_id: a.id, b_id: b.id, kind: "related", confidence: 0.77, source: "judge" });

  const before = state.store.listEdges([a.id, b.id]);
  assert.equal(before.length, 1);

  state.store.rebuild();
  const after = state.store.listEdges([a.id, b.id]);
  assert.deepEqual(after, before);

  // 콜드 재오픈(생성자 경로)로도 엣지가 정본에서 복원되는지 확인
  const reopened = state.reopen();
  const cold = reopened.listEdges([a.id, b.id]);
  assert.equal(cold.length, 1);
  assert.equal(cold[0].confidence, 0.77);
});

test("render view includes a Backlinks section built from stored edges only", (t) => {
  const { store, home } = isolatedStore(t);
  const a = remember(store, { claim: "포트는 3000", scope: "project:alpha" }, config);
  const b = remember(store, { claim: "회고는 금요일", scope: "project:alpha" }, config);
  store.upsertEdge({ a_id: a.id, b_id: b.id, kind: "related", confidence: 0.9, source: "judge" });

  renderViews(store, home);
  const view = fs.readFileSync(path.join(home, "views", "project-alpha.md"), "utf8");
  assert.match(view, /## Backlinks/u);
  // TASK-FIX-B12: edge orientation is normalized by the (random) fact-id order, so the
  // rendered endpoints may appear in either order — accept both to remove pre-existing flake.
  assert.match(view, /포트는 3000 ↔ 회고는 금요일|회고는 금요일 ↔ 포트는 3000/u);
});
