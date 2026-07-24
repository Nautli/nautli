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
  factChecksum,
  importExportFile,
  verifyRoundTrip,
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
  const seededStore = new Store(fixture.source);
  seededStore.addFact(fact("fa_unicode_emoji", "서울 카페 ☕ 선호 규칙", {
    scope: "project:portable",
    t_valid: "2025-02-04",
  }));
  seededStore.close();
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
    ["서울 카페 ☕ 선호 규칙", "project:portable"],
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
  // TASK-107: exercise the deterministic verifier sample, including its non-ASCII/emoji query.
  const verified = verifyRoundTrip(fixture.source, output);
  assert.ok(verified.recall_queries >= 5);
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

// TASK-107: Each hardened import invariant has an independently actionable error.
test("import rejects invalid scope, timestamp, claim hash, and supersession link distinctly", (t) => {
  const fixture = makeFixture(t, "nautli-export-validation-");
  const validFile = path.join(fixture.root, "valid.json");
  writeExportFile(fixture.source, validFile);
  const valid = JSON.parse(fs.readFileSync(validFile, "utf8"));
  const cases = [
    {
      name: "bad-scope",
      mutate(snapshot) { snapshot.facts[0].scope = "workspace:portable"; },
      pattern: /facts\[0\]\.scope: invalid scope "workspace:portable"/,
    },
    {
      name: "bad-timestamp",
      mutate(snapshot) { snapshot.facts[0].t_created = "not-a-timestamp"; },
      pattern: /facts\[0\]\.t_created: invalid timestamp/,
    },
    {
      name: "claim-hash-mismatch",
      mutate(snapshot) { snapshot.facts[0].claim_hash = "0".repeat(40); },
      pattern: /facts\[0\]\.claim_hash: does not match claim/,
    },
    {
      name: "dangling-supersession",
      mutate(snapshot) { snapshot.facts[0].superseded_by = "fa_missing"; },
      pattern: /facts\[0\]\.superseded_by: dangling fact id "fa_missing"/,
    },
    // TASK-FIX-B12 (M-2): an enum-invalid fact type must be rejected before it enters the store.
    {
      name: "bad-type",
      mutate(snapshot) { snapshot.facts[0].type = "bogus"; },
      pattern: /facts\[0\]\.type: unknown type "bogus"/,
    },
  ];

  for (const entry of cases) {
    const snapshot = structuredClone(valid);
    entry.mutate(snapshot);
    snapshot.checksum = factChecksum(snapshot.facts, snapshot.events);
    const file = path.join(fixture.root, `${entry.name}.json`);
    const target = path.join(fixture.root, `target-${entry.name}`);
    fs.writeFileSync(file, `${JSON.stringify(snapshot)}\n`, "utf8");
    assert.throws(
      () => importExportFile(file, target),
      (error) => error.code === "E_INVALID_INPUT" && entry.pattern.test(error.message),
    );
    assert.equal(fs.existsSync(target), false);
  }
});

// TASK-107: A conservative estimate rejects before Store.query()/event parsing allocates a snapshot.
test("export pre-estimate enforces E_EXPORT_TOO_LARGE without reading an oversized snapshot", (t) => {
  const fixture = makeFixture(t, "nautli-export-size-limit-");
  // Sparse storage keeps this regression test small while the 3x SQLite estimate exceeds 256 MiB.
  fs.truncateSync(path.join(fixture.source, "index.sqlite"), 90 * 1024 * 1024);

  assert.throws(
    () => createExportSnapshot(fixture.source),
    (error) => error.code === "E_EXPORT_TOO_LARGE"
      && /Export estimate \d+ bytes exceeds 268435456 byte limit/.test(error.message),
  );
});

// TASK-107: A failed staging->target rename must put an existing target back exactly as it was.
test("import rename fault restores an existing target home intact", (t) => {
  const fixture = makeFixture(t, "nautli-import-rename-rollback-");
  const exported = path.join(fixture.root, "portable.json");
  const target = path.join(fixture.root, "target");
  const marker = path.join(target, "original.txt");
  writeExportFile(fixture.source, exported);
  fs.mkdirSync(target);
  fs.writeFileSync(marker, "original target survives\n", "utf8");

  const originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = function renameSyncWithFault(from, to, ...args) {
    if (!injected && from.startsWith(`${target}.tmp-`) && to === target) {
      injected = true;
      const error = new Error("injected staging rename failure");
      error.code = "EIO";
      throw error;
    }
    return originalRename.call(this, from, to, ...args);
  };
  try {
    assert.throws(() => importExportFile(exported, target), /injected staging rename failure/);
  } finally {
    fs.renameSync = originalRename;
  }

  assert.equal(injected, true);
  assert.equal(fs.readFileSync(marker, "utf8"), "original target survives\n");
  assert.deepEqual(fs.readdirSync(target), ["original.txt"]);
  assert.deepEqual(
    fs.readdirSync(fixture.root).filter((name) => name.startsWith("target.bak-")),
    [],
  );
});

// TASK-107: A parent-directory fsync failure retains the backup until rollback succeeds.
test("import fsync failure rolls back rather than deleting the backup early", (t) => {
  const fixture = makeFixture(t, "nautli-import-fsync-rollback-");
  const exported = path.join(fixture.root, "portable.json");
  const target = path.join(fixture.root, "target");
  const marker = path.join(target, "original.txt");
  writeExportFile(fixture.source, exported);
  fs.mkdirSync(target);
  fs.writeFileSync(marker, "original target survives\n", "utf8");

  const originalRename = fs.renameSync;
  const originalFsync = fs.fsyncSync;
  const originalRemove = fs.rmSync;
  let failNextFsync = false;
  let installedReplacement = false;
  let removedBackup = false;
  fs.renameSync = function renameSyncWithFsyncFault(from, to, ...args) {
    const result = originalRename.call(this, from, to, ...args);
    if (from.startsWith(`${target}.tmp-`) && to === target) {
      installedReplacement = true;
      failNextFsync = true;
    }
    return result;
  };
  fs.fsyncSync = function fsyncSyncWithFault(descriptor) {
    if (failNextFsync) {
      failNextFsync = false;
      const error = new Error("injected parent fsync failure");
      error.code = "EIO";
      throw error;
    }
    return originalFsync.call(this, descriptor);
  };
  fs.rmSync = function rmSyncWithBackupWatch(entry, ...args) {
    if (String(entry).startsWith(`${target}.bak-`)) removedBackup = true;
    return originalRemove.call(this, entry, ...args);
  };
  try {
    assert.throws(() => importExportFile(exported, target), /injected parent fsync failure/);
  } finally {
    fs.renameSync = originalRename;
    fs.fsyncSync = originalFsync;
    fs.rmSync = originalRemove;
  }

  assert.equal(installedReplacement, true);
  assert.equal(removedBackup, false, "backup must not be deleted before replacement verification succeeds");
  assert.equal(fs.readFileSync(marker, "utf8"), "original target survives\n");
  assert.deepEqual(fs.readdirSync(target), ["original.txt"]);
  assert.deepEqual(
    fs.readdirSync(fixture.root).filter((name) => name.startsWith("target.bak-")),
    [],
  );
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

// TASK-FIX-B12 (H-1): once the replacement is verified the live home is authoritative.
// A backup-cleanup fault must NOT delete the verified home or restore a partial backup;
// it leaves the backup behind with a marker and returns success + a warning (data safe).
test("TASK-FIX-B12 a backup-cleanup fault after verification keeps the verified home", (t) => {
  const fixture = makeFixture(t, "nautli-import-cleanup-after-verify-");
  const exported = path.join(fixture.root, "portable.json");
  const target = path.join(fixture.root, "target");
  const marker = path.join(target, "original.txt");
  writeExportFile(fixture.source, exported);
  fs.mkdirSync(target);
  fs.writeFileSync(marker, "stale original\n", "utf8");

  const originalRemove = fs.rmSync;
  let injected = false;
  fs.rmSync = function rmSyncWithBackupFault(entry, ...args) {
    if (!injected && String(entry).startsWith(`${target}.bak-`)) {
      injected = true;
      const error = new Error("injected backup cleanup failure");
      error.code = "EIO";
      throw error;
    }
    return originalRemove.call(this, entry, ...args);
  };
  let result;
  try {
    result = importExportFile(exported, target);
  } finally {
    fs.rmSync = originalRemove;
  }

  // The import SUCCEEDED and surfaced a warning rather than throwing.
  assert.equal(injected, true);
  assert.equal(result.home, target);
  assert.ok(Array.isArray(result.warnings) && /cleanup incomplete/.test(result.warnings[0]));

  // The verified replacement is live (imported facts, NOT the stale original marker).
  assert.equal(fs.existsSync(marker), false);
  const store = new Store(target);
  t.after(() => store.close());
  assert.ok(store.getFact("fa_chain_a2"));

  // The backup is left behind with a stale-backup marker for manual cleanup.
  const backups = fs.readdirSync(fixture.root).filter((name) => name.startsWith("target.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(
    fs.existsSync(path.join(fixture.root, backups[0], "README-NAUTLI-STALE-BACKUP.txt")),
    true,
  );
});

// TASK-FIX-B12 (M-1): an oversized export file is rejected by size before it is read
// into memory.
test("TASK-FIX-B12 readExportFile rejects an oversized file before loading it", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-export-read-cap-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "huge.json");
  fs.writeFileSync(file, "{}", "utf8");
  // Sparse truncate keeps the test cheap while the on-disk size exceeds the 256 MiB cap.
  fs.truncateSync(file, 256 * 1024 * 1024 + 1);
  assert.throws(
    () => importExportFile(file, path.join(dir, "target")),
    (error) => error.code === "E_EXPORT_TOO_LARGE"
      && /exceeds 268435456 byte limit/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(dir, "target")), false);
});

// TASK-FIX-B12 (M-3): the pending review queue is carried in the export and restored on
// import, so a pending contradiction (markers/conflicts_with) survives a round trip.
test("TASK-FIX-B12 a pending review card survives export -> import", (t) => {
  const fixture = makeFixture(t, "nautli-export-review-");
  const queueEntry = {
    pair_id: "fa_active:fa_chain_a2",
    verdict: "contradiction",
    confidence: 0.9,
    status: "pending",
    claims: { a: "coffee preference is light", b: "service port is 4000" },
  };
  fs.mkdirSync(path.join(fixture.source, "review"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture.source, "review", "queue.jsonl"),
    `${JSON.stringify(queueEntry)}\n`,
    "utf8",
  );

  const output = path.join(fixture.root, "with-review.json");
  writeExportFile(fixture.source, output);
  const snapshot = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(snapshot.minor, 1);
  assert.deepEqual(snapshot.review, [queueEntry]);

  const importedHome = path.join(fixture.root, "imported-review");
  importExportFile(output, importedHome);

  // The queue file is restored verbatim.
  const restored = fs.readFileSync(path.join(importedHome, "review", "queue.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(restored, [queueEntry]);

  // The pending contradiction maps both ACTIVE facts to each other again.
  const store = new Store(importedHome);
  t.after(() => store.close());
  const contradictions = store.activeContradictions();
  assert.ok(contradictions.get("fa_active")?.has("fa_chain_a2"));
  assert.ok(contradictions.get("fa_chain_a2")?.has("fa_active"));
});

// TASK-FIX-B12 (M-3): a legacy export with no `review` field still imports cleanly.
test("TASK-FIX-B12 a legacy export without a review field imports fine", (t) => {
  const fixture = makeFixture(t, "nautli-export-review-legacy-");
  const output = path.join(fixture.root, "legacy.json");
  writeExportFile(fixture.source, output);
  const snapshot = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(Object.hasOwn(snapshot, "review"), false); // no pending cards -> no review key
  delete snapshot.minor; // simulate a pre-M3 file lacking the minor marker
  const legacy = path.join(fixture.root, "legacy-nominor.json");
  fs.writeFileSync(legacy, `${JSON.stringify(snapshot)}\n`, "utf8");

  const importedHome = path.join(fixture.root, "imported-legacy");
  assert.doesNotThrow(() => importExportFile(legacy, importedHome));
  const store = new Store(importedHome);
  t.after(() => store.close());
  assert.ok(store.getFact("fa_chain_a2"));
});
