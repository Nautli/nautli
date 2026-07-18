import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildIndex,
  buildSessionStartOutput,
  computeArm,
  deriveScope,
  isExcludedSession,
} from "../src/session-start/index.js";
import {
  installSessionStartHook,
  sessionStartHookStatus,
  uninstallSessionStartHook,
} from "../src/session-start/hooks.js";
import { computeJudgment } from "../src/session-start/judgment.js";
import { Store } from "../src/core/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

function isolatedHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-ss-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedFacts(home, scope, count = 3) {
  const store = new Store(home);
  for (let i = 0; i < count; i++) {
    store.addFact({
      id: `fact-${scope}-${i}`,
      type: "assertion",
      scope,
      subject: "",
      claim: `Test fact number ${i} about ${scope}`,
      confidence: 0.9,
      provenance: { source: "test" },
      t_valid: "2026-07-18",
    });
  }
  store.close();
}

// --- Token budget tests ---
test("buildIndex respects token budget (300 tokens max)", (t) => {
  const home = isolatedHome(t);
  const scope = "project:testproj";
  // Seed many facts to exceed budget
  const store = new Store(home);
  for (let i = 0; i < 100; i++) {
    store.addFact({
      id: `fact-${i.toString().padStart(3, "0")}`,
      type: "assertion",
      scope,
      subject: "",
      claim: `Long claim number ${i} with some padding text to consume tokens quickly and reliably`,
      confidence: 0.9,
      provenance: { source: "test" },
      t_valid: "2026-07-18",
    });
  }
  store.close();

  const result = buildIndex(home, scope);
  assert.ok(result.tokens <= 300, `tokens ${result.tokens} exceeds budget 300`);
  assert.ok(result.facts.length > 0);
  assert.ok(result.facts.length < 100);
});

// --- Person scope exclusion ---
test("buildIndex excludes person scope (only project scope)", (t) => {
  const home = isolatedHome(t);
  const store = new Store(home);
  store.addFact({
    id: "person-fact-1",
    type: "assertion",
    scope: "person",
    subject: "",
    claim: "Personal fact that should not appear",
    confidence: 0.9,
    provenance: { source: "test" },
    t_valid: "2026-07-18",
  });
  store.addFact({
    id: "project-fact-1",
    type: "assertion",
    scope: "project:myapp",
    subject: "",
    claim: "Project fact that should appear",
    confidence: 0.9,
    provenance: { source: "test" },
    t_valid: "2026-07-18",
  });
  store.close();

  const result = buildIndex(home, "project:myapp");
  assert.ok(result.facts.includes("project-fact-1"));
  assert.ok(!result.facts.includes("person-fact-1"));
});

// --- Person scope defensive guard ---
test("buildIndex rejects person scope directly", (t) => {
  const home = isolatedHome(t);
  const store = new Store(home);
  store.addFact({
    id: "person-fact-direct",
    type: "assertion",
    scope: "person",
    subject: "",
    claim: "Should never appear in index",
    confidence: 0.9,
    provenance: { source: "test" },
    t_valid: "2026-07-18",
  });
  store.close();

  const result = buildIndex(home, "person");
  assert.equal(result.facts.length, 0);
  assert.equal(result.index, "");
});

// --- Arm fixedness (deterministic) ---
test("computeArm is deterministic for same salt+session", () => {
  const salt = "d09e7f72-ceba-4a91-9f5f-5caa9b65ec7b";
  const session = "sess-abc-123";
  const arm1 = computeArm(salt, session);
  const arm2 = computeArm(salt, session);
  assert.equal(arm1, arm2);
  assert.ok(arm1 === 0 || arm1 === 1);
});

test("computeArm varies across sessions", () => {
  const salt = "d09e7f72-ceba-4a91-9f5f-5caa9b65ec7b";
  const arms = new Set();
  for (let i = 0; i < 20; i++) {
    arms.add(computeArm(salt, `session-${i}`));
  }
  // With 20 sessions, extremely unlikely all map to same arm
  assert.equal(arms.size, 2);
});

test("resumed session gets same arm", () => {
  const salt = "test-salt-fixed";
  const session = "resumed-session-id";
  const first = computeArm(salt, session);
  const second = computeArm(salt, session);
  assert.equal(first, second);
});

// --- Session exclusion ---
test("isExcludedSession rejects subagent/daemon/test sessions", () => {
  assert.ok(isExcludedSession("subagent-xyz", "/tmp"));
  assert.ok(isExcludedSession("agent-foo", "/tmp"));
  assert.ok(isExcludedSession("test-unit-abc", "/tmp"));
  assert.ok(isExcludedSession("ci-pipeline-42", "/tmp"));
  assert.ok(isExcludedSession("normal-id", "/Users/x/.nautli/daemon"));
  assert.ok(!isExcludedSession("normal-session", "/Users/x/Desktop/myproject"));
});

test("isExcludedSession rejects empty/null session", () => {
  assert.ok(isExcludedSession("", "/tmp"));
  assert.ok(isExcludedSession(null, "/tmp"));
  assert.ok(isExcludedSession(undefined, "/tmp"));
});

// --- deriveScope ---
test("deriveScope maps cwd to project scope", () => {
  const config = {
    capture_projects: {
      "/Users/x/Desktop/nautli": { enabled: true },
      "/Users/x/Desktop": { enabled: true },
    },
  };
  assert.equal(deriveScope("/Users/x/Desktop/nautli", config), "project:nautli");
  assert.equal(deriveScope("/Users/x/Desktop/nautli/src", config), "project:nautli");
  assert.equal(deriveScope("/Users/x/other", config), null);
});

test("deriveScope returns null for disabled projects", () => {
  const config = {
    capture_projects: {
      "/Users/x/Desktop/nautli": { enabled: false },
    },
  };
  assert.equal(deriveScope("/Users/x/Desktop/nautli", config), null);
});

// --- buildSessionStartOutput integration ---
test("buildSessionStartOutput returns control for arm=0", (t) => {
  const home = isolatedHome(t);
  seedFacts(home, "project:testproj", 3);

  // Find a session that maps to arm=0
  const salt = "test-salt-arm0";
  let sessionId;
  for (let i = 0; i < 100; i++) {
    const candidate = `session-${i}`;
    if (computeArm(salt, candidate) === 0) {
      sessionId = candidate;
      break;
    }
  }

  const config = {
    capture_projects: { "/tmp/testproj": { enabled: true } },
    telemetry: { install_id: salt },
  };

  const result = buildSessionStartOutput(home, {
    sessionId,
    cwd: "/tmp/testproj",
    config,
  });
  assert.equal(result.injected, false);
  assert.equal(result.arm, 0);
  assert.equal(result.reason, "control_arm");
});

test("buildSessionStartOutput returns output for arm=1", (t) => {
  const home = isolatedHome(t);
  seedFacts(home, "project:testproj", 3);

  const salt = "test-salt-arm1";
  let sessionId;
  for (let i = 0; i < 100; i++) {
    const candidate = `session-${i}`;
    if (computeArm(salt, candidate) === 1) {
      sessionId = candidate;
      break;
    }
  }

  const config = {
    capture_projects: { "/tmp/testproj": { enabled: true } },
    telemetry: { install_id: salt },
  };

  const result = buildSessionStartOutput(home, {
    sessionId,
    cwd: "/tmp/testproj",
    config,
  });
  assert.equal(result.injected, true);
  assert.equal(result.arm, 1);
  assert.ok(result.output.includes("nautli"));
  assert.ok(result.output.includes("recall"));
});

// --- Hook installation ---
test("installSessionStartHook adds SessionStart entry to settings.json", (t) => {
  const userHome = isolatedHome(t);
  fs.mkdirSync(path.join(userHome, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(userHome, ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: ["Read"] } }),
    "utf8",
  );

  const result = installSessionStartHook({ userHome });
  assert.ok(result.installed);
  assert.ok(result.changed);
  assert.ok(result.command.includes("session-start-hook"));

  const settings = JSON.parse(
    fs.readFileSync(path.join(userHome, ".claude", "settings.json"), "utf8"),
  );
  assert.ok(Array.isArray(settings.hooks.SessionStart));
  assert.ok(
    settings.hooks.SessionStart.some((entry) =>
      entry.hooks?.some((hook) => hook.command?.includes("session-start-hook")),
    ),
  );
});

test("uninstallSessionStartHook removes managed entry", (t) => {
  const userHome = isolatedHome(t);
  installSessionStartHook({ userHome });
  const result = uninstallSessionStartHook({ userHome });
  assert.ok(!result.installed);
  assert.ok(result.changed);
});

// --- Judgment ---
test("computeJudgment returns valid structure with no events", (t) => {
  const home = isolatedHome(t);
  fs.mkdirSync(path.join(home, "events"), { recursive: true });
  const result = computeJudgment(home);
  assert.equal(result.kind, "session-start-judgment");
  assert.equal(result.control.eligible_sessions, 0);
  assert.equal(result.treatment.eligible_sessions, 0);
  assert.equal(result.decision, "CONTINUE");
  assert.ok(result.proxy_note);
});

test("computeJudgment triggers HOLD on person-scope recall in treatment", (t) => {
  const home = isolatedHome(t);
  const eventsDir = path.join(home, "events");
  fs.mkdirSync(eventsDir, { recursive: true });

  const events = [
    // session-start event for treatment arm
    { ev: "session_start.index", session_id: "s1", cwd: "/tmp/proj", scope: "project:proj", experiment_arm: 1, fact_count: 3, tokens: 20, at: "2026-07-18T10:00:00.000Z" },
    // recall with person scope (leak!)
    { type: "recall", tool: "recall", query: "personal info", scope: "person", hits: ["f1"], session_id: "s1", at: "2026-07-18T10:01:00.000Z" },
  ];
  fs.writeFileSync(
    path.join(eventsDir, "2026-07.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );

  const result = computeJudgment(home);
  assert.equal(result.treatment.wrong_scope_recalls, 1);
  assert.equal(result.decision, "HOLD");
});

test("computeJudgment does NOT trigger HOLD on wrong-scope in control arm", (t) => {
  const home = isolatedHome(t);
  const eventsDir = path.join(home, "events");
  fs.mkdirSync(eventsDir, { recursive: true });

  const events = [
    // control arm session with wrong-scope recall
    { ev: "session_start.index", session_id: "c1", cwd: "/tmp/proj", scope: "project:proj", experiment_arm: 0, fact_count: 3, tokens: 20, at: "2026-07-18T10:00:00.000Z" },
    { type: "recall", tool: "recall", query: "other project", scope: "project:other", hits: ["f1"], session_id: "c1", at: "2026-07-18T10:01:00.000Z" },
  ];
  fs.writeFileSync(
    path.join(eventsDir, "2026-07.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );

  const result = computeJudgment(home);
  assert.equal(result.control.wrong_scope_recalls, 1);
  // HOLD only checks treatment arm
  assert.equal(result.decision, "CONTINUE");
});

test("computeJudgment excludes wrong-scope recall from useful_consumptions", (t) => {
  const home = isolatedHome(t);
  const eventsDir = path.join(home, "events");
  fs.mkdirSync(eventsDir, { recursive: true });

  const events = [
    { ev: "session_start.index", session_id: "t1", cwd: "/tmp/proj", scope: "project:proj", experiment_arm: 1, fact_count: 3, tokens: 20, at: "2026-07-18T10:00:00.000Z" },
    // wrong-scope recall with hits — should NOT count as useful consumption
    { type: "recall", tool: "recall", query: "leak", scope: "person", hits: ["f1"], session_id: "t1", at: "2026-07-18T10:01:00.000Z" },
  ];
  fs.writeFileSync(
    path.join(eventsDir, "2026-07.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );

  const result = computeJudgment(home);
  assert.equal(result.treatment.useful_consumptions, 0);
  assert.equal(result.treatment.non_empty_recalls, 1);
});

// --- CLI integration ---
test("session-start-hook CLI outputs nothing for excluded session", (t) => {
  const home = isolatedHome(t);
  seedFacts(home, "project:desktop", 2);

  const payload = JSON.stringify({
    session_id: "subagent-test",
    cwd: "/Users/x/Desktop",
  });

  const result = spawnSync(process.execPath, [cli, "session-start-hook"], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "");
});

// --- Privacy notice compliance ---
test("topicOf truncates claims longer than 60 chars", (t) => {
  const home = isolatedHome(t);
  const longSecret = "The database password for production server at db.internal.corp is xK9#mP2$vL7@nQ4wR8&jF1!cT6yB3hA5 and expires 2027-01-01";
  assert.ok(longSecret.length > 60, "test claim must exceed 60 chars");
  const store = new Store(home);
  store.addFact({
    id: "secret-fact-001",
    type: "assertion",
    scope: "project:myapp",
    subject: "",
    claim: longSecret,
    confidence: 0.9,
    provenance: { source: "test" },
    t_valid: "2026-07-18",
  });
  store.close();

  const result = buildIndex(home, "project:myapp");
  assert.ok(result.index.includes("secret-f")); // id prefix (8 chars)
  assert.ok(result.index.includes("2026-07-18")); // date
  // Full claim must NOT appear (truncated with "...")
  assert.ok(!result.index.includes(longSecret));
  assert.ok(result.index.includes("..."), "truncated topic should end with ...");
});
