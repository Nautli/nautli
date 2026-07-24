// TASK-106
import test from "node:test";
// TASK-106
import assert from "node:assert/strict";
// TASK-106
import { createHash } from "node:crypto";
// TASK-106
import fs from "node:fs";
// TASK-106
import os from "node:os";
// TASK-106
import path from "node:path";
// TASK-106
import { spawnSync } from "node:child_process";
// TASK-106
import { runScan } from "../src/scan/index.js";
// TASK-106
import { checkupPreflight, startCheckup } from "../src/onboard/checkup.js";

// TASK-106
function temporaryDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// TASK-106
function fileDigest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// TASK-106
function snapshotTree(root) {
  const entries = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file);
      const stat = fs.lstatSync(file);
      entries.set(relative, {
        sha256: entry.isFile() ? fileDigest(file) : null,
        size: stat.size,
        mode: stat.mode,
        mtimeMs: stat.mtimeMs,
        type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      });
      if (entry.isDirectory()) walk(file);
    }
  };
  walk(root);
  return entries;
}

// TASK-106
function compareSnapshots(before, after) {
  const differences = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const relative of [...paths].sort()) {
    const oldEntry = before.get(relative);
    const newEntry = after.get(relative);
    if (!oldEntry) differences.push({ type: "addition", path: relative });
    else if (!newEntry) differences.push({ type: "deletion", path: relative });
    else if (JSON.stringify(oldEntry) !== JSON.stringify(newEntry)) {
      differences.push({ type: "change", path: relative, before: oldEntry, after: newEntry });
    }
  }
  return differences;
}

// TASK-106
function cloneSnapshot(snapshot) {
  return new Map([...snapshot].map(([relative, entry]) => [relative, { ...entry }]));
}

// TASK-106
function fixtureVault(t) {
  const userHome = temporaryDirectory(t, "nautli-trust-guard-");
  const vault = path.join(userHome, "vault");
  fs.mkdirSync(path.join(vault, "nested"), { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "# Local note\n");
  fs.writeFileSync(path.join(vault, "nested", "memory.txt"), "local memory\n");
  return { userHome, vault };
}

// TASK-106
test("snapshot comparator detects content, timestamp, addition, deletion, and rename mutations", () => {
  const before = new Map([
    ["note.md", { sha256: "one", size: 3, mode: 0o100644, mtimeMs: 10, type: "file" }],
  ]);

  const contentChanged = cloneSnapshot(before);
  contentChanged.set("note.md", { ...contentChanged.get("note.md"), sha256: "two" });
  assert.equal(compareSnapshots(before, contentChanged).length, 1);

  const timestampChanged = cloneSnapshot(before);
  timestampChanged.set("note.md", { ...timestampChanged.get("note.md"), mtimeMs: 11 });
  assert.equal(compareSnapshots(before, timestampChanged).length, 1);

  const added = cloneSnapshot(before);
  added.set("new.md", { sha256: "new", size: 3, mode: 0o100644, mtimeMs: 10, type: "file" });
  assert.deepEqual(compareSnapshots(before, added), [{ type: "addition", path: "new.md" }]);

  const deleted = new Map();
  assert.deepEqual(compareSnapshots(before, deleted), [{ type: "deletion", path: "note.md" }]);

  const renamed = new Map([["renamed.md", before.get("note.md")]]);
  assert.deepEqual(compareSnapshots(before, renamed), [
    { type: "deletion", path: "note.md" },
    { type: "addition", path: "renamed.md" },
  ]);
});

// TASK-106
test("scan leaves every fixture vault entry unchanged when opening and network ping are disabled", async (t) => {
  const { userHome, vault } = fixtureVault(t);
  const config = path.join(userHome, ".config", "obsidian");
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, "obsidian.json"), JSON.stringify({ vaults: { fixture: { path: vault } } }));
  const before = snapshotTree(vault);

  const scan = await runScan({ cwd: vault, home: userHome, platform: "linux", noOpen: true, noPing: true });
  t.after(() => fs.rmSync(path.dirname(scan.reportFile), { recursive: true, force: true }));

  // TASK-106
  assert.ok(scan.result.tools.some((tool) => tool.files >= 2));
  assert.deepEqual(compareSnapshots(before, snapshotTree(vault)), []);
});

// TASK-106
test("checkup vault-reading preflight leaves every fixture vault entry unchanged", (t) => {
  const { userHome, vault } = fixtureVault(t);
  const before = snapshotTree(vault);
  const runner = (command) => ({ status: command === "python3" || command === "claude" ? 0 : 1 });

  const preflight = checkupPreflight(path.join(userHome, ".nautli"), vault, { userHome, runner });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.files, 1);
  assert.deepEqual(compareSnapshots(before, snapshotTree(vault)), []);
});

// TASK-113
test("vault snapshots flag a note mutation from the spawned checkup judge", (t) => {
  const { userHome, vault } = fixtureVault(t);
  const home = path.join(userHome, ".nautli");
  const note = path.join(vault, "note.md");
  const before = snapshotTree(vault);
  const mockJudge = (command, args, options) => {
    assert.equal(command, "python3");
    assert.ok(args.includes("--max-judge-pairs"));
    assert.equal(options.detached, true);
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[1], '\\nmutated by mock judge\\n');",
      note,
    ], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    return { pid: 999999991, unref() {}, on() {} };
  };

  const started = startCheckup(home, vault, { userHome, spawner: mockJudge });
  const differences = compareSnapshots(before, snapshotTree(vault));

  assert.equal(started.started, true);
  assert.throws(() => assert.deepEqual(differences, []), { name: "AssertionError" });
  assert.deepEqual(differences.map((difference) => ({ type: difference.type, path: difference.path })), [
    { type: "change", path: "note.md" },
  ]);
});

// TASK-106
function runScript(script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    encoding: "utf8",
  });
}

// TASK-106
// TASK-113
test("trust-claims checker passes the ledger and reports a broken link plus bogus table commit", (t) => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const script = path.join(root, "scripts", "check-trust-claims.js");
  const ledger = path.join(root, "docs", "TRUST-CLAIMS.md");
  const passed = runScript(script, [ledger]);
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);

  const fixture = path.join(temporaryDirectory(t, "nautli-trust-ledger-"), "ledger.md");
  fs.writeFileSync(fixture, "| evidence | [missing](missing.md) | `abcdef0` |\n");
  const failed = runScript(script, [fixture]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /broken link: missing\.md/);
  assert.match(failed.stderr, /broken commit: abcdef0/);
});

// TASK-113
test("trust-claims checker checks backtick artifacts and ignores prose hex", (t) => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const script = path.join(root, "scripts", "check-trust-claims.js");
  const directory = temporaryDirectory(t, "nautli-trust-artifact-");
  const missing = path.join(directory, "missing.md");
  fs.writeFileSync(missing, "Evidence artifact: `missing-artifact.md`\n");

  const failed = runScript(script, [missing]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /broken artifact: missing-artifact\.md/);

  const prose = path.join(directory, "prose.md");
  fs.writeFileSync(prose, "The diagnostic batch identifier abcdef01 is prose, not a commit claim.\n");
  const passed = runScript(script, [prose]);
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);
});

// TASK-106
test("network allowlist checker accepts src and rejects external network fixtures", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const script = path.join(root, "scripts", "check-network-allowlist.js");
  const source = path.join(root, "src");
  const fixtures = path.join(root, "test", "fixtures", "network-allowlist");

  const passed = runScript(script, [source]);
  assert.equal(passed.status, 0, passed.stderr || passed.stdout);

  const failed = runScript(script, [fixtures]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /external-fetch\.js:2/);
  assert.match(failed.stderr, /http-get\.js:5/);
  assert.match(failed.stderr, /node-https\.js:2/);
  // TASK-BATCH-FIX (F-4): the hardened checker also flags obfuscated egress bypasses.
  assert.match(failed.stderr, /dynamic-import-nonliteral\.js:2/); // import("node:"+"https")
  assert.match(failed.stderr, /computed-global-fetch\.js:2/); // globalThis["f"+"etch"]
  assert.match(failed.stderr, /aliased-fetch\.js:2/); // const fetchImpl = fetch
});
