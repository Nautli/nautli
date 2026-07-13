import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { initStore } from "../src/onboard/setup.js";
import {
  checkupCandidates,
  readCurrent,
  checkupStatus,
  dismissCheckup,
  importCheckup,
  startCheckup,
  validateVaultPath,
} from "../src/onboard/checkup.js";

function tempHome(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("checkupCandidates finds an obsidian vault and the claude harness", (t) => {
  const userHome = tempHome(t, "nautli-cand-");
  const vault = path.join(userHome, "Documents", "myvault");
  fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "# a");
  fs.mkdirSync(path.join(userHome, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(userHome, ".claude", "CLAUDE.md"), "# rules");
  const found = checkupCandidates({ userHome });
  const kinds = found.map((candidate) => candidate.kind).sort();
  assert.deepEqual(kinds, ["claude-harness", "obsidian"]);
  const obsidian = found.find((candidate) => candidate.kind === "obsidian");
  assert.equal(obsidian.path, vault);
  assert.equal(obsidian.notes, 1);
});

test("validateVaultPath rejects outside-home and nautli-home targets", (t) => {
  const userHome = tempHome(t, "nautli-guard-");
  const home = path.join(userHome, ".nautli");
  fs.mkdirSync(home, { recursive: true });
  assert.throws(() => validateVaultPath("/etc", { userHome, home }), /홈 폴더 안/);
  assert.throws(() => validateVaultPath(home, { userHome, home }), /자신은 진단 대상이 아니/);
  assert.throws(() => validateVaultPath(path.join(userHome, "없는폴더"), { userHome, home }), /찾을 수 없/);
  const vault = path.join(userHome, "vault");
  fs.mkdirSync(vault);
  // realpath 정규화(symlink 해소) 계약 — macOS tmp(/var→/private/var)에서도 canonical 경로를 돌려준다
  assert.equal(validateVaultPath(vault, { userHome, home }), fs.realpathSync(vault));
  const link = path.join(userHome, "vault-link");
  fs.symlinkSync(home, link);
  assert.throws(() => validateVaultPath(link, { userHome, home }), /자신은 진단 대상이 아니/);
});

test("startCheckup records a running state and refuses a second concurrent run", (t) => {
  const userHome = tempHome(t, "nautli-start-");
  const home = path.join(userHome, ".nautli");
  const vault = path.join(userHome, "vault");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "# 기억 노트");
  const spawner = () => ({ pid: process.pid, unref() {}, on() {} });
  const started = startCheckup(home, vault, { userHome, spawner });
  assert.equal(started.started, true);
  assert.equal(checkupStatus(home).state, "running");
  assert.throws(() => startCheckup(home, vault, { userHome, spawner }), /이미 돌고/);
});

test("checkupStatus surfaces summary and cards, importCheckup loads atoms through the gate", (t) => {
  const userHome = tempHome(t, "nautli-import-");
  const home = path.join(userHome, ".nautli");
  const vault = path.join(userHome, "vault");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "# 기억 노트");
  const spawner = () => ({ pid: 999999999, unref() {}, on() {} }); // 죽은 pid → 프로세스 종료로 간주
  startCheckup(home, vault, { userHome, spawner });
  const runDir = readCurrent(home).run_dir; // 시작 시점에 확정된 run_dir이 정본 (추측 금지 계약)
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({
    score: 62, notes: 30, atoms: 3, duplicates: 1, contradictions: 1, junk_rate: 0.1, review_cards: 2,
  }));
  fs.writeFileSync(path.join(runDir, "pairs.jsonl"), [
    JSON.stringify({ a: "fa_1", b: "fa_2", claim_a: "포트는 3100", claim_b: "포트는 3200", src_a: "a.md", src_b: "b.md" }),
  ].join("\n"));
  fs.writeFileSync(path.join(runDir, "judgments.jsonl"), [
    JSON.stringify({ pair_id: "fa_1|fa_2", verdict: "contradiction", confidence: 0.9, newer: "b" }),
  ].join("\n"));
  fs.writeFileSync(path.join(runDir, "atoms.jsonl"), [
    JSON.stringify({ id: "fa_1", claim: "체크업 임포트 검증용 포트는 3100", scope: "project:vault", type: "semantic", source: "a.md", t_valid: "2026-01-01" }),
    JSON.stringify({ id: "fa_2", claim: "체크업 임포트 검증용 배포 전 테스트를 돌린다", scope: "project:vault", type: "procedural", source: "b.md" }),
    JSON.stringify({ id: "fa_3", claim: "체크업 임포트 검증용 포트는 3100", scope: "project:vault", type: "semantic", source: "c.md" }),
  ].join("\n"));

  const status = checkupStatus(home);
  assert.equal(status.state, "done");
  assert.equal(status.summary.score, 62);
  assert.equal(status.cards.length, 1);
  assert.equal(status.cards[0].kind, "contradiction");

  initStore(home);
  const result = importCheckup(home, { default_scope: "person" });
  assert.equal(result.imported, 2);
  assert.equal(result.duplicates, 1); // fa_3 = fa_1과 동일 claim → 게이트가 거름
  const store = new Store(home);
  try {
    const facts = store.query();
    assert.equal(facts.filter((fact) => fact.provenance?.source === "checkup").length, 2);
    assert.ok(facts.some((fact) => fact.scope === "procedure")); // procedural type → procedure scope
  } finally {
    store.close();
  }
  assert.equal(checkupStatus(home).state, "imported");
  dismissCheckup(home);
  assert.equal(checkupStatus(home).state, "dismissed");
});
