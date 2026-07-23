// TASK-023: scope 이원화 해소 — 별칭(alias)로 recall을 canonical+alias로 확장한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { recall } from "../src/core/recall.js";
import { initStore } from "../src/onboard/setup.js";
import { readCurrent, startCheckup, importCheckup } from "../src/onboard/checkup.js";

const config = { default_scope: "person", judge_cmd: null };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-alias-"));
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

function tempHome(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("recall on canonical returns facts from both the canonical and aliased scopes", (t) => {
  const { store } = isolatedStore(t);
  const canonicalFact = remember(store, { claim: "슬랩 스캔은 최우선 게이트다", scope: "project:pokecard", confidence: 0.9 }, config);
  const aliasFact = remember(store, { claim: "포켓몬 카드 실물 100장 스캔 PoC", scope: "project:포켓몬카드앱", confidence: 0.9 }, config);

  // 별칭 설정 전: canonical recall은 canonical scope의 fact만 본다
  const before = recall(store, "스캔", { scope: "project:pokecard" });
  assert.ok(before.facts.some((fact) => fact.id === canonicalFact.id));
  assert.ok(!before.facts.some((fact) => fact.id === aliasFact.id));

  store.setScopeAlias("project:포켓몬카드앱", "project:pokecard");

  // 별칭 설정 후: canonical recall이 양쪽 scope fact를 모두 포괄
  const after = recall(store, "스캔", { scope: "project:pokecard" });
  const ids = after.facts.map((fact) => fact.id);
  assert.ok(ids.includes(canonicalFact.id));
  assert.ok(ids.includes(aliasFact.id));
  // 저장된 fact의 scope는 재기록되지 않는다
  assert.equal(after.facts.find((fact) => fact.id === aliasFact.id).scope, "project:포켓몬카드앱");
  assert.equal(store.getFact(aliasFact.id).scope, "project:포켓몬카드앱");
});

test("recall on the alias also expands to the canonical's facts", (t) => {
  const { store } = isolatedStore(t);
  const canonicalFact = remember(store, { claim: "슬랩 스캔은 최우선 게이트다", scope: "project:pokecard", confidence: 0.9 }, config);
  const aliasFact = remember(store, { claim: "포켓몬 카드 실물 100장 스캔 PoC", scope: "project:포켓몬카드앱", confidence: 0.9 }, config);
  store.setScopeAlias("project:포켓몬카드앱", "project:pokecard");

  const result = recall(store, "스캔", { scope: "project:포켓몬카드앱" });
  const ids = result.facts.map((fact) => fact.id);
  assert.ok(ids.includes(canonicalFact.id));
  assert.ok(ids.includes(aliasFact.id));
});

test("expandScope returns canonical + all aliases in both directions", (t) => {
  const { store } = isolatedStore(t);
  store.setScopeAlias("project:포켓몬카드앱", "project:pokecard");
  store.setScopeAlias("project:poke", "project:pokecard");

  assert.deepEqual(new Set(store.expandScope("project:pokecard")),
    new Set(["project:pokecard", "project:포켓몬카드앱", "project:poke"]));
  assert.deepEqual(new Set(store.expandScope("project:포켓몬카드앱")),
    new Set(["project:pokecard", "project:포켓몬카드앱", "project:poke"]));
});

test("rebuild preserves scope aliases (derived from the event log)", (t) => {
  const state = isolatedStore(t);
  state.store.setScopeAlias("project:포켓몬카드앱", "project:pokecard");
  assert.equal(state.store.listScopeAliases().length, 1);

  state.store.rebuild();
  const afterRebuild = state.store.listScopeAliases();
  assert.equal(afterRebuild.length, 1);
  assert.equal(afterRebuild[0].alias, "project:포켓몬카드앱");
  assert.equal(afterRebuild[0].canonical, "project:pokecard");

  // 콜드 재오픈으로도 정본에서 복원
  const reopened = state.reopen();
  assert.equal(reopened.expandScope("project:pokecard").length, 2);
});

test("setScopeAlias rejects self-aliases and empty inputs", (t) => {
  const { store } = isolatedStore(t);
  assert.throws(() => store.setScopeAlias("project:x", "project:x"));
  assert.throws(() => store.setScopeAlias("", "project:x"));
  assert.throws(() => store.setScopeAlias("project:x", ""));
});

test("CLI `scope alias` binds an alias and recall expands over it", (t) => {
  const home = tempHome(t, "nautli-alias-cli-");
  const set = spawnSync(process.execPath, [cli, "scope", "alias", "project:포켓몬카드앱", "--to", "project:pokecard"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
  assert.equal(set.status, 0, set.stderr || set.stdout);
  const out = JSON.parse(set.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.alias, "project:포켓몬카드앱");
  assert.equal(out.canonical, "project:pokecard");

  const store = new Store(home);
  try {
    assert.deepEqual(new Set(store.expandScope("project:pokecard")),
      new Set(["project:pokecard", "project:포켓몬카드앱"]));
  } finally {
    store.close();
  }
});

test("importCheckup returns scope_suggestions for near-duplicate scopes without auto-merging", (t) => {
  const userHome = tempHome(t, "nautli-scopesug-");
  const home = path.join(userHome, ".nautli");
  const vault = path.join(userHome, "vault");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "# 기억 노트");
  const spawner = () => ({ pid: 999999999, unref() {}, on() {} });
  startCheckup(home, vault, { userHome, spawner });
  const runDir = readCurrent(home).run_dir;
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ score: 70, notes: 10, atoms: 1 }));
  fs.writeFileSync(path.join(runDir, "judgments.jsonl"), "");
  fs.writeFileSync(path.join(runDir, "atoms.jsonl"), [
    JSON.stringify({ id: "fa_a", claim: "포켓몬 카드 스캔은 최우선이다", scope: "project:PokeCard", type: "semantic", source: "a.md" }),
  ].join("\n"));

  initStore(home);
  // 기존 scope 시드: project:pokecard (정규화 시 "pokecard"로 새 scope project:PokeCard와 충돌)
  const seed = new Store(home);
  try {
    remember(seed, { claim: "포켓몬 앱 기준선", scope: "project:pokecard" }, config);
  } finally {
    seed.close();
  }

  const result = importCheckup(home, { default_scope: "person" });
  assert.ok(Array.isArray(result.scope_suggestions));
  const suggestion = result.scope_suggestions.find((entry) => entry.scope === "project:PokeCard");
  assert.ok(suggestion, "PokeCard should be suggested against pokecard");
  assert.equal(suggestion.canonical, "project:pokecard");

  // NO auto-merge: fact는 원래 scope로 저장되어 남는다
  const store = new Store(home);
  try {
    assert.ok(store.query({ scope: "project:PokeCard" }).length >= 1);
    assert.equal(store.listScopeAliases().length, 0);
  } finally {
    store.close();
  }
});
