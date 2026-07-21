import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "vendor", "vault-doctor", "test_sampler.py");

// NEARDUP-SAMPLER 불변식: 온보딩 맛보기 표본이 볼트의 실제 near-dup 쌍을 포함해야 한다.
// (파이썬 순수 로컬 로직 — LLM 없음. python3는 checkup의 기존 의존성.)
test("vault-doctor near-dup sampler surfaces duplicate clusters (python)", () => {
  const res = spawnSync("python3", [script], { encoding: "utf8" });
  if (res.error && res.error.code === "ENOENT") {
    // python3 미설치 환경(checkup 자체가 불가) — 스킵 대신 안내.
    assert.ok(true, "python3 not available; skipping sampler invariant test");
    return;
  }
  assert.equal(res.status, 0, `sampler test failed:\n${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /test_sampler: PASS/);
});
