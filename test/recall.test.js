import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall, briefing } from "../src/core/recall.js";
import { ERR } from "../src/core/schema.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-recall-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return store;
}

function chain(store) {
  const a = remember(store, {
    claim: "배포 포트는 3000",
    scope: "project:alpha",
    t_valid: "2025-01-01",
    confidence: 0.9,
  }, config);
  const b = remember(store, {
    claim: "배포 포트는 3500",
    scope: "project:alpha",
    t_valid: "2025-02-01",
    confidence: 0.9,
    supersedes: a.id,
  }, config);
  const c = remember(store, {
    claim: "배포 포트는 4000",
    scope: "project:alpha",
    t_valid: "2025-03-01",
    confidence: 0.9,
    supersedes: b.id,
  }, config);
  return { a, b, c };
}

test("recall returns only the active end of a supersede chain", (t) => {
  const store = isolatedStore(t);
  const { c } = chain(store);
  const result = recall(store, "배포 포트", { scope: "project:alpha" });
  assert.deepEqual(result.facts.map((fact) => fact.id), [c.id]);
  assert.match(result.briefing, /4000/);
  assert.doesNotMatch(result.briefing, /3000|3500/);
});

test("as_of returns the fact valid at the requested past time", (t) => {
  const store = isolatedStore(t);
  const { a } = chain(store);
  const result = recall(store, "배포 포트", {
    scope: "project:alpha",
    as_of: "2025-01-15",
  });
  assert.deepEqual(result.facts.map((fact) => fact.id), [a.id]);
  assert.match(result.briefing, /1\/1 기준/);
});

test("greedy packing never exceeds the token budget", (t) => {
  const store = isolatedStore(t);
  for (let index = 0; index < 12; index += 1) {
    remember(store, {
      claim: `예산 검증 사실 ${index} ${"x".repeat(90)}`,
      scope: "project:budget",
      t_valid: `2025-04-${String(index + 1).padStart(2, "0")}`,
    }, config);
  }
  const result = recall(store, "예산 검증", {
    scope: "project:budget",
    budget_tokens: 200,
  });
  assert.ok(result.tokens_used <= 200);
});

test("budgets below 200 throw E_BUDGET_TOO_SMALL", (t) => {
  const store = isolatedStore(t);
  assert.throws(() => recall(store, "anything", { budget_tokens: 100 }), {
    message: ERR.E_BUDGET_TOO_SMALL,
    code: ERR.E_BUDGET_TOO_SMALL,
  });
});

test("an unrelated task with no scoped recent candidates returns W_EMPTY", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "고양이는 창가를 좋아한다" }, config);
  assert.deepEqual(recall(store, "양자역학 실험 장비", {}), {
    briefing: "",
    facts: [],
    tokens_used: 0,
    warning: ERR.W_EMPTY,
  });
});

// TASK-056 regression tests — precision

test("TASK-056: cross-scope noise suppressed (신상 query must not surface nautli facts)", (t) => {
  const store = isolatedStore(t);
  const today = new Date().toISOString().slice(0, 10);
  remember(store, {
    claim: "nautli recall precision 개선 완료",
    scope: "project:nautli",
    t_valid: today,
    confidence: 0.97,
  }, config);
  remember(store, {
    claim: "nautli 소화 데몬 정상 가동 중",
    scope: "project:nautli",
    t_valid: today,
    confidence: 0.95,
  }, config);
  remember(store, {
    claim: "신상속보 수집기 정상 가동",
    scope: "project:shinsang",
    t_valid: today,
    confidence: 0.9,
  }, config);

  const result = recall(store, "신상 올릴거없냐", { scope: "project:shinsang" });
  // nautli facts must NOT appear
  for (const fact of result.facts) {
    assert.ok(!fact.scope.includes("nautli"), `unexpected nautli fact: ${fact.claim}`);
  }
});

test("TASK-056: scope-matched fact surfaces in top-k (pawcha query finds pawcha)", (t) => {
  const store = isolatedStore(t);
  const today = new Date().toISOString().slice(0, 10);
  // Add many unrelated facts
  for (let i = 0; i < 20; i++) {
    remember(store, {
      claim: `무관 사실 ${i} 오늘 날씨 좋다`,
      scope: "project:misc",
      t_valid: today,
      confidence: 0.8,
    }, config);
  }
  remember(store, {
    claim: "pawcha 앱스토어 심사거부 상태",
    scope: "project:pawcha",
    t_valid: today,
    confidence: 0.9,
  }, config);

  const result = recall(store, "pawcha 상태", { scope: "project:pawcha" });
  assert.ok(result.facts.length >= 1, "should find at least 1 pawcha fact");
  assert.ok(result.facts.some((f) => f.claim.includes("pawcha")), "pawcha fact must be in results");
});

test("TASK-056: novel topic with no matches returns low noise (abstain-like)", (t) => {
  const store = isolatedStore(t);
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 15; i++) {
    remember(store, {
      claim: `프로젝트 ${i} 개발 진행 중`,
      scope: "project:dev",
      t_valid: today,
      confidence: 0.9,
    }, config);
  }
  const result = recall(store, "오목 게임 규칙");
  // Should return very few or zero results — no FTS match for 오목
  assert.ok(result.facts.length <= 2, `expected ≤2 noise facts, got ${result.facts.length}`);
});

test("TASK-056: default budget is 700 (not 2000)", (t) => {
  const store = isolatedStore(t);
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 30; i++) {
    remember(store, {
      claim: `기본 예산 검증 사실 ${i} ${"x".repeat(60)}`,
      scope: "project:budget",
      t_valid: today,
    }, config);
  }
  const result = recall(store, "예산 검증", { scope: "project:budget" });
  // top-k 8 cap means at most 8 facts even if budget allows more
  assert.ok(result.facts.length <= 8, `top-k cap: expected ≤8, got ${result.facts.length}`);
  assert.ok(result.tokens_used <= 700, `default budget: expected ≤700, got ${result.tokens_used}`);
});

test("TASK-056: briefing uses separate budget (2000) and includes recents", (t) => {
  const store = isolatedStore(t);
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 25; i++) {
    remember(store, {
      claim: `브리핑 사실 ${i} 오늘 기록`,
      scope: "project:brief",
      t_valid: today,
    }, config);
  }
  const result = briefing(store, "", "project:brief");
  // briefing has top_k=20 and _include_recents, so can return more than recall's 8
  assert.ok(result.facts.length > 8, `briefing should return >8 facts, got ${result.facts.length}`);
  assert.ok(result.facts.length <= 20, "briefing top-k should cap at 20");
});
