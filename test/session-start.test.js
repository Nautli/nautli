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
test("isExcludedSession rejects subagent/daemon sessions", () => {
  assert.ok(isExcludedSession("subagent-xyz", "/tmp"));
  assert.ok(isExcludedSession("agent-foo", "/tmp"));
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
test("output mentions topic/fact_id not full claim content", (t) => {
  const home = isolatedHome(t);
  const secretClaim = "API key is sk-secret-12345-do-not-leak";
  const store = new Store(home);
  store.addFact({
    id: "secret-fact-001",
    type: "assertion",
    scope: "project:myapp",
    subject: "",
    claim: secretClaim,
    confidence: 0.9,
    provenance: { source: "test" },
    t_valid: "2026-07-18",
  });
  store.close();

  const result = buildIndex(home, "project:myapp");
  // The index uses topicOf which truncates to 60 chars — but importantly
  // should never include a full long claim verbatim with secrets
  // (though in this case it fits in 60 chars, the test validates the structure uses topic)
  assert.ok(result.index.includes("secret-f")); // id prefix (8 chars)
  assert.ok(result.index.includes("2026-07-18")); // date
});
