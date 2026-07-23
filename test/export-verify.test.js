// TASK-098
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recall } from "../src/core/recall.js";
import {
  compareFactSnapshots,
  createExportSnapshot,
  importExportFile,
  writeExportFile,
} from "../src/core/portability.js";
import { claimHash, STATUS } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

// TASK-098
function fact(id, claim, overrides = {}) {
  return {
    id,
    type: overrides.type ?? "semantic",
    scope: overrides.scope ?? "project:portable",
    subject: overrides.subject ?? "portability",
    claim,
    confidence: overrides.confidence ?? 0.85,
    provenance: overrides.provenance ?? {
      source: "export-test",
      context: { file: "MEMORY.md", line: 7 },
    },
    t_valid: overrides.t_valid ?? "2025-01-01",
    t_invalid: overrides.t_invalid ?? null,
    t_created: overrides.t_created ?? "2025-01-01T00:00:00.000Z",
    t_expired: overrides.t_expired ?? null,
    superseded_by: overrides.superseded_by ?? null,
    status: overrides.status ?? STATUS.ACTIVE,
    claim_hash: overrides.claim_hash ?? claimHash(claim),
  };
}

// TASK-098
function makeFixture(t, prefix = "nautli-export-test-") {
  const rootHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const source = path.join(rootHome, "source");
  const store = new Store(source);

  store.addFact(fact("fa_active", "coffee preference is light", {
    scope: "person",
    t_valid: "2025-01-02",
  }));
  store.addFact(fact("fa_chain_a1", "service port is 3000", {
    t_valid: "2025-01-03",
  }));
  store.addFact(fact("fa_chain_a2", "service port is 4000", {
    t_valid: "2025-02-03",
  }));
  store.transition("fa_chain_a1", STATUS.SUPERSEDED, {
    superseded_by: "fa_chain_a2",
    t_invalid: "2025-02-03",
  }, "client");
  store.addFact(fact("fa_invalid", "retired deployment instruction", {
    scope: "procedure",
    t_valid: "2025-01-04",
  }));
  store.transition("fa_invalid", STATUS.INVALIDATED, {
    t_invalid: "2025-03-01",
  }, "daemon");
  store.addFact(fact("fa_purged", "body removed by purge", {
    t_valid: "2025-01-05",
  }));
  store.purge(["fa_purged"], { source: "export-test" });
  store.close();

  t.after(() => fs.rmSync(rootHome, { recursive: true, force: true }));
  return { root: rootHome, source };
}

// TASK-098
function runCli(home, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
}

// TASK-098
function recallFactIds(store, query, scope) {
  return recall(store, query, {
    scope,
    budget_tokens: 2000,
    top_k: 20,
    source: "export-test",
  }).facts.map((entry) => entry.id);
}

test("round-trip export and import preserve every logical fact row and purge tombstone", (t) => {
  const fixture = makeFixture(t);
  const output = path.join(fixture.root, "portable.json");
  const importedHome = path.join(fixture.root, "imported");

  const exported = runCli(fixture.source, ["export", "--out", output]);
  assert.equal(exported.status, 0, exported.stderr || exported.stdout);
  assert.match(exported.stdout, /Exported 4 facts and \d+ events/);

  const snapshot = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.ok(snapshot.events.some((event) => event.ev === "fact.purged"));
  assert.ok(!snapshot.facts.some((entry) => entry.id === "fa_purged"));

  const imported = runCli(fixture.source, ["import", output, "--home", importedHome]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  assert.match(imported.stdout, /Imported 4 facts and \d+ events/);

  const sourceStore = new Store(fixture.source);
  const targetStore = new Store(importedHome);
  t.after(() => {
    sourceStore.close();
    targetStore.close();
  });
  const diff = compareFactSnapshots(sourceStore.query(), targetStore.query());
  assert.deepEqual(diff, { equal: true, missing: [], unexpected: [], changed: [] });
  assert.equal(targetStore.getFact("fa_chain_a1").superseded_by, "fa_chain_a2");
  assert.equal(targetStore.getFact("fa_chain_a1").status, STATUS.SUPERSEDED);
  assert.deepEqual(
    targetStore.getFact("fa_active").provenance,
    sourceStore.getFact("fa_active").provenance,
  );
});

// TASK-098-fix
test("export rejects a nonexistent home without creating it", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-export-missing-"));
  const missingHome = path.join(temporaryRoot, "does-not-exist");
  const output = path.join(temporaryRoot, "portable.json");
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  const result = runCli(missingHome, ["export", "--out", output]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    new RegExp(`nautli home not found or empty: ${missingHome} — nothing to export`),
  );
  assert.equal(fs.existsSync(missingHome), false);
  assert.equal(fs.existsSync(output), false);
});

// TASK-098-fix
test("export refuses an output path inside the nautli home", (t) => {
  const fixture = makeFixture(t, "nautli-export-inside-home-");
  const output = path.join(fixture.source, "portable.json");

  const result = runCli(fixture.source, ["export", "--out", output]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /refusing to write export inside the nautli home/);
  assert.equal(fs.existsSync(output), false);
});

// TASK-098-fix
test("export detects an events-file size change between snapshot passes", (t) => {
  const fixture = makeFixture(t, "nautli-export-torn-");
  const eventsDirectory = path.join(fixture.source, "events");
  const eventFile = path.join(eventsDirectory, fs.readdirSync(eventsDirectory).sort()[0]);

  assert.throws(
    () => createExportSnapshot(
      fixture.source,
      "2025-04-01T00:00:00.000Z",
      {
        afterSnapshot() {
          fs.appendFileSync(
            eventFile,
            `${JSON.stringify({ ev: "test.concurrent-write", at: "2025-04-01T00:00:00.000Z" })}\n`,
          );
        },
      },
    ),
    /store changed during export; retry/,
  );
});

test("recall fact-id sets and top-k order remain equal across three runs", (t) => {
  const fixture = makeFixture(t, "nautli-export-recall-");
  const output = path.join(fixture.root, "portable.json");
  const importedHome = path.join(fixture.root, "imported");
  writeExportFile(fixture.source, output);
  importExportFile(output, importedHome);

  const sourceStore = new Store(fixture.source);
  const targetStore = new Store(importedHome);
  t.after(() => {
    sourceStore.close();
    targetStore.close();
  });
  const queries = [
    ["service port", "project:portable"],
    ["coffee preference", "person"],
    ["deployment instruction", "procedure"],
  ];
  for (let run = 0; run < 3; run += 1) {
    for (const [query, scope] of queries) {
      const sourceIds = recallFactIds(sourceStore, query, scope);
      const importedIds = recallFactIds(targetStore, query, scope);
      assert.deepEqual(importedIds, sourceIds, `top-k order differs on run ${run + 1}`);
      assert.deepEqual(
        [...new Set(importedIds)].sort(),
        [...new Set(sourceIds)].sort(),
        `fact-id set differs on run ${run + 1}`,
      );
    }
  }
});

test("export --verify reports separate file-integrity and round-trip proofs", (t) => {
  const fixture = makeFixture(t, "nautli-export-proof-");
  const output = path.join(fixture.root, "verified.json");
  const result = runCli(fixture.source, ["export", "--verify", "--out", output]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  // TASK-098-fix
  assert.match(result.stdout, /FILE INTEGRITY: PASS.*facts\+events checksum verified/);
  assert.match(result.stdout, /ROUND-TRIP: PASS/);
  assert.match(result.stdout, /VERIFY: PASS/);
});

test("corrupt fact, count mismatch, and unknown format fail distinctly without a target home", (t) => {
  const fixture = makeFixture(t, "nautli-export-failures-");
  const validFile = path.join(fixture.root, "valid.json");
  writeExportFile(fixture.source, validFile);
  const valid = JSON.parse(fs.readFileSync(validFile, "utf8"));

  const cases = [
    {
      name: "missing-field",
      mutate(snapshot) {
        delete snapshot.facts[0].claim;
      },
      pattern: /missing required field "claim"/,
    },
    {
      name: "counts",
      mutate(snapshot) {
        snapshot.counts.facts += 1;
      },
      pattern: /Export counts mismatch/,
    },
    {
      name: "format",
      mutate(snapshot) {
        snapshot.format = "nautli-export/999";
      },
      pattern: /Unknown export format: nautli-export\/999/,
    },
    // TASK-098-fix
    {
      name: "event-checksum",
      mutate(snapshot) {
        snapshot.events[0].source = "checksum-tampered";
      },
      pattern: /Export checksum mismatch/,
    },
  ];
  const messages = [];
  for (const entry of cases) {
    const snapshot = structuredClone(valid);
    entry.mutate(snapshot);
    const file = path.join(fixture.root, `${entry.name}.json`);
    fs.writeFileSync(file, `${JSON.stringify(snapshot)}\n`, "utf8");
    const target = path.join(fixture.root, `target-${entry.name}`);
    assert.throws(
      () => importExportFile(file, target),
      (error) => {
        messages.push(error.message);
        assert.match(error.message, entry.pattern);
        return true;
      },
    );
    assert.equal(fs.existsSync(target), false);
  }
  assert.equal(new Set(messages).size, cases.length);
});

// TASK-098-fix
test("export --verify retains but does not verify an export when event rewriting changes order", (t) => {
  const fixture = makeFixture(t, "nautli-export-verify-failure-");
  const eventsDirectory = path.join(fixture.source, "events");
  fs.writeFileSync(
    path.join(eventsDirectory, "2098-01.jsonl"),
    `${JSON.stringify({ ev: "test.first", at: "2099-01-01T00:00:00.000Z" })}\n`,
  );
  fs.writeFileSync(
    path.join(eventsDirectory, "2099-01.jsonl"),
    `${JSON.stringify({ ev: "test.second", at: "2098-01-01T00:00:00.000Z" })}\n`,
  );
  const output = path.join(fixture.root, "not-verified.json");

  const result = runCli(fixture.source, ["export", "--verify", "--out", output]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /ROUND-TRIP: FAIL — Round-trip event rows mismatch/);
  assert.match(
    result.stdout,
    new RegExp(`VERIFY: FAIL — export file retained but NOT verified: ${output}`),
  );
  assert.equal(fs.existsSync(output), true);
});
