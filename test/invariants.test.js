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

test("source never removes rows from the facts table", () => {
  for (const file of sourceFiles(path.join(root, "src"))) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /DELETE\s+FROM\s+facts\b(?!_fts)/i, path.relative(root, file));
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
