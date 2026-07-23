// TASK-105
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TASK-105
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const fixture = path.join(root, "test", "fixtures", "audit-f1.jsonl");

// TASK-105
function auditHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-audit-cli-"));
  const events = path.join(home, "events");
  fs.mkdirSync(events, { recursive: true });
  fs.copyFileSync(fixture, path.join(events, "2026-07.jsonl"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// TASK-105
function runCli(home, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
}

// TASK-105
function runAudit(home, args) {
  const result = runCli(home, ["audit", ...args]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

// TASK-105
function auditError(home, args) {
  const result = runCli(home, ["audit", ...args]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

// TASK-105
test("audit as-of returns the four F1 validity sets with strict invalidation", (t) => {
  const home = auditHome(t);
  for (const [at, factIds] of [
    ["2026-07-02", ["fa_A1"]],
    ["2026-07-04", ["fa_A2"]],
    ["2026-07-05", ["fa_A2", "fa_B1"]],
    ["2026-07-07", ["fa_A2"]],
  ]) {
    assert.deepEqual(runAudit(home, ["as-of", at, "--scope", "project:demo"]), {
      at,
      scope: "project:demo",
      fact_ids: factIds,
    });
  }
});

// TASK-105
test("audit delivery returns the exact F1 A1, A2, and B1 histories", (t) => {
  const home = auditHome(t);
  assert.deepEqual(runAudit(home, ["delivery", "fa_A1"]), {
    fact_id: "fa_A1",
    deliveries: [{
      at: "2026-07-02T08:00:00Z",
      tool: "briefing",
      session_id: "S1",
      query: "",
      scope: "project:demo",
    }],
  });
  assert.deepEqual(runAudit(home, ["delivery", "fa_A2"]), {
    fact_id: "fa_A2",
    deliveries: [{
      at: "2026-07-04T14:00:00Z",
      tool: "recall",
      session_id: "S2",
      query: "서버 포트",
      scope: "project:demo",
    }],
  });
  assert.deepEqual(runAudit(home, ["delivery", "fa_B1"]), {
    fact_id: "fa_B1",
    deliveries: [],
  });
});

// TASK-105
test("audit delivery chain lists F1 predecessors oldest first", (t) => {
  const home = auditHome(t);
  assert.deepEqual(runAudit(home, ["delivery", "fa_A2", "--chain"]), {
    fact_id: "fa_A2",
    deliveries: [{
      at: "2026-07-04T14:00:00Z",
      tool: "recall",
      session_id: "S2",
      query: "서버 포트",
      scope: "project:demo",
    }],
    versions: [
      {
        fact_id: "fa_A1",
        deliveries: [{
          at: "2026-07-02T08:00:00Z",
          tool: "briefing",
          session_id: "S1",
          query: "",
          scope: "project:demo",
        }],
      },
      {
        fact_id: "fa_A2",
        deliveries: [{
          at: "2026-07-04T14:00:00Z",
          tool: "recall",
          session_id: "S2",
          query: "서버 포트",
          scope: "project:demo",
        }],
      },
    ],
  });
});

// TASK-105
test("audit verdict returns normalized F1 A1 and B1 decision chains", (t) => {
  const home = auditHome(t);
  assert.deepEqual(runAudit(home, ["verdict", "fa_A1"]), {
    fact_id: "fa_A1",
    current_status: "superseded",
    events: [
      {
        kind: "added",
        at: "2026-07-01T09:00:00Z",
        source: "mcp",
        action: null,
        confidence: null,
        actor: null,
        reason: null,
        policy_version: null,
        by: null,
      },
      {
        kind: "superseded",
        at: "2026-07-03T10:00:01Z",
        source: null,
        action: null,
        confidence: null,
        actor: "client",
        reason: "user supersedes via remember",
        policy_version: "n/a",
        by: "fa_A2",
      },
    ],
  });
  assert.deepEqual(runAudit(home, ["verdict", "fa_B1"]), {
    fact_id: "fa_B1",
    current_status: "invalidated",
    events: [
      {
        kind: "added",
        at: "2026-07-05T03:30:00Z",
        source: "daemon",
        action: null,
        confidence: null,
        actor: null,
        reason: null,
        policy_version: null,
        by: null,
      },
      {
        kind: "capture.decided",
        at: "2026-07-05T03:30:00Z",
        source: null,
        action: "remember",
        confidence: 0.8,
        actor: null,
        reason: null,
        policy_version: "triage@3",
        by: null,
      },
      {
        kind: "invalidated",
        at: "2026-07-06T03:30:00Z",
        source: null,
        action: null,
        confidence: null,
        actor: "daemon",
        reason: "contradiction resolved against fa_B1",
        policy_version: "resolver@2",
        by: null,
      },
    ],
  });
});

// TASK-105
test("audit applies ev_id first-wins while repeated legacy lines remain distinct", (t) => {
  const home = auditHome(t);
  const eventFile = path.join(home, "events", "2026-07.jsonl");
  const duplicateEvId = [
    {
      ev: "fact.added",
      ev_id: "ev_duplicate",
      at: "2026-07-07T00:00:00Z",
      fact: { id: "fa_first_wins", scope: "project:demo", t_valid: "2026-07-07", t_invalid: null },
    },
    {
      ev: "fact.added",
      ev_id: "ev_duplicate",
      at: "2026-07-07T00:00:01Z",
      fact: { id: "fa_loses_duplicate", scope: "project:demo", t_valid: "2026-07-07", t_invalid: null },
    },
  ];
  const legacyRecall = {
    type: "recall",
    tool: "recall",
    at: "2026-07-07T01:00:00Z",
    query: "legacy repeat",
    scope: "project:demo",
    hits: ["fa_A2"],
  };
  fs.appendFileSync(eventFile, `${duplicateEvId.map(JSON.stringify).join("\n")}\n${JSON.stringify(legacyRecall)}\n${JSON.stringify(legacyRecall)}\n`);
  assert.deepEqual(runAudit(home, ["as-of", "2026-07-07", "--scope", "project:demo"]).fact_ids, [
    "fa_A2",
    "fa_first_wins",
  ]);
  const deliveries = runAudit(home, ["delivery", "fa_A2"]).deliveries;
  assert.equal(deliveries.length, 3);
  assert.deepEqual(deliveries.slice(1), [
    { at: "2026-07-07T01:00:00Z", tool: "recall", session_id: null, query: "legacy repeat", scope: "project:demo" },
    { at: "2026-07-07T01:00:00Z", tool: "recall", session_id: null, query: "legacy repeat", scope: "project:demo" },
  ]);
});

// TASK-105
test("audit rejects a malformed JSONL line instead of silently skipping it", (t) => {
  const home = auditHome(t);
  fs.appendFileSync(path.join(home, "events", "2026-07.jsonl"), "{malformed json}\n");
  assert.equal(
    auditError(home, ["as-of", "2026-07-07", "--scope", "project:demo"]).error,
    "E_INVALID_INPUT",
  );
});

// TASK-105
test("audit rejects missing facts, invalid time, missing scope, and invalid subcommands", (t) => {
  const home = auditHome(t);
  assert.equal(auditError(home, ["delivery", "fa_missing"]).error, "E_NOT_FOUND");
  assert.equal(auditError(home, ["verdict", "fa_missing"]).error, "E_NOT_FOUND");
  assert.equal(auditError(home, ["as-of", "not-a-time", "--scope", "project:demo"]).error, "E_INVALID_INPUT");
  assert.equal(auditError(home, ["as-of", "2026-07-07"]).error, "E_INVALID_INPUT");
  assert.equal(auditError(home, ["unknown"]).error, "E_INVALID_INPUT");
});
