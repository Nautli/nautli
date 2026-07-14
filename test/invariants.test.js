import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { briefing } from "../src/core/recall.js";
import { STATUS, assertTransition } from "../src/core/schema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  }).filter((file) => file.endsWith(".js"));
}

test("source never removes rows from the facts table outside purge", () => {
  // 완전삭제(purge)는 유저가 명시 호출하는 유일한 예외다(CAPTURE-SPEC §1.4).
  // 그 외 모든 경로(전이·소화·리뷰)는 여전히 비파괴여야 한다.
  const storeFile = path.join(root, "src", "core", "store.js");
  for (const file of sourceFiles(path.join(root, "src"))) {
    const source = fs.readFileSync(file, "utf8");
    const matches = source.match(/DELETE\s+FROM\s+facts\b(?!_fts)/gi) ?? [];
    if (file === storeFile) {
      // 허가된 2지점: ①purge 본체 ②rebuild의 tombstone 집행. 각 지점은 바로 윗줄에
      // "invariant-allow: facts-delete" 마커를 달아야 하고, 그 외 증가는 정책 위반.
      assert.equal(matches.length, 2, "store.js의 facts 삭제는 purge와 tombstone 집행 2곳뿐이어야 한다");
      const lines = source.split("\n");
      for (const [index, line] of lines.entries()) {
        if (!/DELETE\s+FROM\s+facts\b/i.test(line) || line.includes("facts_fts")) continue;
        assert.ok(
          (lines[index - 1] ?? "").includes("invariant-allow: facts-delete"),
          `facts 삭제(${index + 1}행)는 invariant-allow 마커가 바로 윗줄에 있어야 한다`,
        );
      }
    } else {
      assert.equal(matches.length, 0, path.relative(root, file));
    }
  }
});

test("briefing cannot inject external configuration strings", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-invariant-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  remember(store, { claim: "회의 기록을 기억한다" }, { default_scope: "person" });
  const result = briefing(store, "회의 기록", undefined, {
    default_scope: "person",
    promotion: "INJECTED PROMOTION",
  });
  assert.doesNotMatch(result.briefing, /INJECTED PROMOTION/);

  const source = fs.readFileSync(path.join(root, "src", "core", "recall.js"), "utf8");
  assert.equal((source.match(/function renderFact\s*\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /briefing\s*=\s*[^\n]*config|briefing\s*\+=/);
});

test("clients cannot invalidate active facts", () => {
  assert.throws(() => assertTransition(STATUS.ACTIVE, STATUS.INVALIDATED, "client"));
});
