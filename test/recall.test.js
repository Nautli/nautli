import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall } from "../src/core/recall.js";
import { ERR } from "../src/core/schema.js";

const config = { default_scope: "person", judge_cmd: null };

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "onebrain-recall-"));
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
