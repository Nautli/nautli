// TASK-104: 감사 원장 필드 확장 — ev_id/actor/reason/policy_version/session_id + 전달 로깅.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Store,
  readEventLog,
  firstWinsEvents,
  readLogicalEvents,
} from "../src/core/store.js";
import {
  TRANSITION_ACTORS,
  newEventId,
  newId,
  STATUS,
  claimHash,
} from "../src/core/schema.js";
import { remember } from "../src/core/gate.js";
import { recall, briefing } from "../src/core/recall.js";
import { applyCaptureCard } from "../src/core/review.js";
import { applyJudgments } from "../src/daemon/apply.js";
import { RESOLVER_POLICY_VERSION } from "../src/daemon/resolve.js";
import { TRIAGE_POLICY_VERSION } from "../src/daemon/triage.js";
import { renderViews } from "../src/daemon/render.js";
import { writeReport } from "../src/daemon/report.js";
import { handoffCardFactIds } from "../src/core/handoff-card.js";
import { buildSessionStartOutput, buildIndex, computeArm } from "../src/session-start/index.js";
import { startDashboard } from "../src/dashboard/server.js";

// ── helpers ─────────────────────────────────────────────────────────────
function isolatedHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-audit-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function isolatedStore(t) {
  const home = isolatedHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  return store;
}

function makeFact(overrides = {}) {
  const claim = overrides.claim ?? "audit fact";
  return {
    id: overrides.id ?? newId(),
    type: overrides.type ?? "semantic",
    scope: overrides.scope ?? "project:demo",
    subject: overrides.subject ?? "",
    claim,
    confidence: overrides.confidence ?? 0.9,
    provenance: overrides.provenance ?? { source: "test" },
    t_valid: overrides.t_valid ?? "2026-07-18",
    t_invalid: overrides.t_invalid ?? null,
    t_expired: null,
    superseded_by: overrides.superseded_by ?? null,
    status: overrides.status ?? "active",
    claim_hash: claimHash(claim),
  };
}

function readEvents(home) {
  return readEventLog(home);
}

function writeEventsFile(home, events, month = "2026-07") {
  const dir = path.join(home, "events");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${month}.jsonl`),
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
    "utf8",
  );
}

// ── 1. ev_id format + preservation ──────────────────────────────────────
test("newEventId shares fa_ body shape and uses ev_ prefix", () => {
  const now = 1_751_200_000_000;
  const ev = newEventId(now);
  const fa = newId(now);
  assert.match(ev, /^ev_/);
  assert.equal(ev.length, fa.length); // ev_ + 10 ts + 13 rand === fa_ + 10 + 13
  assert.equal(ev.slice(3, 13), fa.slice(3, 13)); // identical 10-char timestamp for same clock
});

test("appendEvent preserves a supplied non-empty ev_id and auto-assigns otherwise", (t) => {
  const store = isolatedStore(t);
  const preserved = store.appendEvent(
    { ev: "note", ev_id: "ev_preserve00000000000", at: "2026-07-01T00:00:00Z" },
    { apply: false },
  );
  assert.equal(preserved.ev_id, "ev_preserve00000000000");

  const auto = store.appendEvent(
    { ev: "note", at: "2026-07-01T00:00:01Z" },
    { apply: false },
  );
  assert.match(auto.ev_id, /^ev_/);
  assert.notEqual(auto.ev_id, "ev_preserve00000000000");

  // A blank ev_id is treated as missing → auto-assigned.
  const blank = store.appendEvent(
    { ev: "note", ev_id: "   ", at: "2026-07-01T00:00:02Z" },
    { apply: false },
  );
  assert.match(blank.ev_id, /^ev_/);
  assert.notEqual(blank.ev_id, "   ");
});

// ── 2. first-wins replay + distinct legacy lines ────────────────────────
test("firstWinsEvents keeps first ev_id and keeps every legacy line distinct", () => {
  const events = [
    { ev: "fact.added", ev_id: "ev_dup", fact: { id: "fa_first" } },
    { ev: "fact.added", ev_id: "ev_dup", fact: { id: "fa_second" } }, // duplicate ev_id → dropped
    { ev: "fact.added", fact: { id: "fa_legacyA" } }, // legacy: no ev_id
    { ev: "fact.added", fact: { id: "fa_legacyB" } }, // legacy: no ev_id (distinct)
  ];
  const logical = firstWinsEvents(events);
  assert.equal(logical.length, 3);
  assert.equal(logical.filter((e) => e.ev_id === "ev_dup").length, 1);
  assert.equal(logical[0].fact.id, "fa_first"); // first occurrence wins
  assert.ok(logical.some((e) => e.fact.id === "fa_legacyA"));
  assert.ok(logical.some((e) => e.fact.id === "fa_legacyB"));
});

test("rebuild replay is idempotent by ev_id and legacy lines stay distinct", (t) => {
  const home = isolatedHome(t);
  const at = "2026-07-05T03:30:00Z";
  const base = (id, claim) => ({
    ev: "fact.added",
    type: "remember",
    source: "test",
    at,
    fact: makeFact({ id, claim, t_created: at }),
  });
  writeEventsFile(home, [
    { ...base("fa_win", "duplicate ev wins claim"), ev_id: "ev_same" },
    { ...base("fa_lose", "duplicate ev loser claim"), ev_id: "ev_same" }, // same ev_id → skipped
    base("fa_legacy1", "legacy line one distinct claim"), // no ev_id
    base("fa_legacy2", "legacy line two distinct claim"), // no ev_id
  ]);
  const store = new Store(home);
  t.after(() => store.close());
  store.rebuild();
  assert.ok(store.getFact("fa_win"), "first ev_id occurrence is applied");
  assert.equal(store.getFact("fa_lose"), null, "duplicate ev_id occurrence is skipped");
  assert.ok(store.getFact("fa_legacy1"), "legacy line one stays distinct");
  assert.ok(store.getFact("fa_legacy2"), "legacy line two stays distinct");
});

test("readLogicalEvents dedups by ev_id over the raw event log", (t) => {
  const home = isolatedHome(t);
  writeEventsFile(home, [
    { ev: "x", ev_id: "ev_a", at: "2026-07-01T00:00:00Z" },
    { ev: "x", ev_id: "ev_a", at: "2026-07-01T00:00:01Z" },
    { ev: "x", at: "2026-07-01T00:00:02Z" },
  ]);
  assert.equal(readEventLog(home).length, 3);
  assert.equal(readLogicalEvents(home).length, 2);
});

// ── 3. required actor/reason/policy stamps ──────────────────────────────
test("gate supersede stamps client actor + exact reason + n/a policy", (t) => {
  const store = isolatedStore(t);
  const first = remember(store, { claim: "server port is 3000", scope: "project:demo" }, {});
  remember(store, {
    claim: "server port is 3200",
    scope: "project:demo",
    supersedes: first.id,
  }, {});
  const superseded = readEvents(store.home).find((e) => e.ev === "fact.superseded");
  assert.ok(superseded);
  assert.equal(superseded.actor, "client");
  assert.equal(superseded.reason, "user supersedes via remember");
  assert.equal(superseded.policy_version, "n/a");
  assert.ok(TRANSITION_ACTORS.includes(superseded.actor));
});

test("judge auto-apply (apply.js) stamps daemon actor + judge:<verdict> reason", (t) => {
  const store = isolatedStore(t);
  const a = store.addFact(makeFact({ claim: "deploy target is vercel", t_valid: "2026-07-01" }));
  const b = store.addFact(makeFact({ claim: "deploy target is vercel edge", t_valid: "2026-07-03" }));
  applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "duplicate",
    confidence: 0.95,
    newer: "b",
  }], {});
  const superseded = readEvents(store.home).find((e) => e.ev === "fact.superseded");
  assert.ok(superseded, "duplicate auto-merge emitted a superseded event");
  assert.equal(superseded.actor, "daemon");
  assert.equal(superseded.reason, "judge:duplicate");
  assert.equal(superseded.policy_version, "n/a");
});

test("transition defaults reason/policy to non-empty n/a when omitted", (t) => {
  const store = isolatedStore(t);
  const fact = store.addFact(makeFact({ claim: "a plain fact for default stamp" }));
  store.transition(fact.id, STATUS.SUPERSEDED, {}, "client");
  const superseded = readEvents(store.home).find((e) => e.ev === "fact.superseded");
  assert.equal(superseded.actor, "client");
  assert.equal(superseded.reason, "n/a");
  assert.equal(superseded.policy_version, "n/a");
});

test("policy_version constants are the director's declared values", () => {
  assert.equal(RESOLVER_POLICY_VERSION, "resolver@2");
  assert.equal(TRIAGE_POLICY_VERSION, "triage@3");
});

test("assertTransition rejects an actor outside the shared enum", (t) => {
  const store = isolatedStore(t);
  const fact = store.addFact(makeFact({ claim: "enum guard fact" }));
  assert.throws(() => store.transition(fact.id, STATUS.SUPERSEDED, {}, "bogus"));
});

// ── 4. capture.decided stamps + fact_id ─────────────────────────────────
function seedCaptureCard(home, overrides = {}) {
  fs.mkdirSync(path.join(home, "review"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "review", "queue.jsonl"),
    `${JSON.stringify({
      type: "capture",
      pair_id: overrides.pair_id ?? "cap:one",
      claim: overrides.claim ?? "captured durable claim",
      scope: overrides.scope ?? "person",
      confidence: 0.8,
      session_id: "cap-session",
      project: "/cap/project",
      at: new Date(Date.now() - 1000).toISOString(),
      status: "pending",
    })}\n`,
    "utf8",
  );
}

test("capture.decided remember always carries fact_id and a client actor", (t) => {
  const home = isolatedHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  seedCaptureCard(home, { pair_id: "cap:one", claim: "captured deploy note is real" });
  const result = applyCaptureCard(store, home, "cap:one", "remember", { default_scope: "person" });
  const decided = readEvents(home).find((e) => e.ev === "capture.decided");
  assert.ok(decided);
  assert.equal(decided.action, "remember");
  assert.equal(decided.actor, "client");
  assert.ok(TRANSITION_ACTORS.includes(decided.actor), "decision actor is a shared-enum value");
  assert.ok(typeof decided.reason === "string" && decided.reason !== "");
  assert.ok(typeof decided.policy_version === "string" && decided.policy_version !== "");
  assert.equal(decided.fact_id, result.remembered.id);
});

test("capture.decided remember to an existing duplicate still carries fact_id", (t) => {
  const home = isolatedHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  const existing = remember(store, { claim: "duplicate resolution target", scope: "person" }, {});
  seedCaptureCard(home, { pair_id: "cap:dup", claim: "duplicate resolution target" });
  applyCaptureCard(store, home, "cap:dup", "remember", { default_scope: "person" });
  const decided = readEvents(home).find((e) => e.ev === "capture.decided");
  assert.equal(decided.action, "remember");
  assert.equal(decided.fact_id, existing.id, "fact_id points at the existing active fact");
});

test("daemon-handled capture.decided uses daemon actor and supplied policy_version", (t) => {
  const home = isolatedHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  seedCaptureCard(home, { pair_id: "cap:daemon", claim: "daemon handled capture claim" });
  applyCaptureCard(store, home, "cap:daemon", "remember", { default_scope: "person" }, {
    actor: "triage",
    reason: "triage:remember",
    policy_version: TRIAGE_POLICY_VERSION,
  });
  const decided = readEvents(home).find((e) => e.ev === "capture.decided");
  assert.equal(decided.actor, "daemon");
  assert.equal(decided.answered_by, "triage", "answered_by label stays separate from actor");
  assert.equal(decided.policy_version, TRIAGE_POLICY_VERSION);
});

// ── 5. session_id: unknown vs absent ────────────────────────────────────
test("appendRecall always writes session_id, defaulting blank/missing to 'unknown'", (t) => {
  const store = isolatedStore(t);
  store.appendRecall({ hits: [], at: "2026-07-01T00:00:00Z" });
  store.appendRecall({ hits: [], session_id: "   ", at: "2026-07-01T00:00:01Z" });
  store.appendRecall({ hits: [], session_id: "sess-real", at: "2026-07-01T00:00:02Z" });
  const recalls = readEvents(store.home).filter((e) => e.type === "recall");
  assert.equal(recalls[0].session_id, "unknown");
  assert.equal(recalls[1].session_id, "unknown");
  assert.equal(recalls[2].session_id, "sess-real");
});

test("absence of session_id identifies only legacy data (not new writes)", (t) => {
  const home = isolatedHome(t);
  // Legacy line written without going through appendRecall.
  writeEventsFile(home, [
    { type: "recall", tool: "recall", hits: ["fa_x"], at: "2026-07-01T00:00:00Z" },
  ]);
  const store = new Store(home);
  t.after(() => store.close());
  store.appendRecall({ hits: ["fa_y"], at: "2026-07-01T00:00:05Z" });
  const recalls = readEvents(home).filter((e) => e.type === "recall");
  const legacy = recalls.find((e) => e.hits.includes("fa_x"));
  const fresh = recalls.find((e) => e.hits.includes("fa_y"));
  assert.equal(Object.hasOwn(legacy, "session_id"), false, "legacy line has no session_id field");
  assert.equal(fresh.session_id, "unknown", "new write always has the field");
});

// ── 6. MCP recall/briefing session_id passthrough (supplied + omitted) ──
// The MCP handlers call recall()/briefing() with these exact option/config keys,
// so the emitted event's session_id proves both supplied and omitted behavior.
test("recall passes a supplied session_id and defaults an omitted one to unknown", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "recall session probe fact", scope: "project:demo" }, {});
  recall(store, "recall session probe", { scope: "project:demo", session_id: "recall-sess" });
  recall(store, "recall session probe", { scope: "project:demo" });
  const recalls = readEvents(store.home).filter((e) => e.type === "recall" && e.tool === "recall");
  assert.equal(recalls[0].session_id, "recall-sess");
  assert.equal(recalls[1].session_id, "unknown");
});

test("briefing passes a supplied session_id and defaults an omitted one to unknown", (t) => {
  const store = isolatedStore(t);
  remember(store, { claim: "briefing session probe fact", scope: "person" }, {});
  briefing(store, "ctx", undefined, { default_scope: "person", session_id: "brief-sess" });
  briefing(store, "ctx", undefined, { default_scope: "person" });
  const briefs = readEvents(store.home).filter((e) => e.type === "recall" && e.tool === "briefing");
  assert.equal(briefs[0].session_id, "brief-sess");
  assert.equal(briefs[1].session_id, "unknown");
});

// ── 7. delivery logging: exact rendered hit sets ────────────────────────
function projectConfig(projectPath, salt) {
  return {
    capture_projects: { [projectPath]: { enabled: true } },
    telemetry: { install_id: salt },
  };
}

function armSession(salt, arm) {
  for (let i = 0; i < 500; i += 1) {
    const sid = `sess-${i}`;
    if (computeArm(salt, sid) === arm) return sid;
  }
  throw new Error(`no session id found for arm ${arm}`);
}

test("session-start.index logs delivery in treatment arm with the exact rendered hit set", (t) => {
  const home = isolatedHome(t);
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-proj-"));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const scope = `project:${path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
  const store = new Store(home);
  store.addFact(makeFact({ scope, claim: "first project fact for index" }));
  store.addFact(makeFact({ scope, claim: "second project fact for index" }));
  store.close();

  const salt = "salt-treatment";
  const sessionId = armSession(salt, 1);
  const config = projectConfig(projectPath, salt);
  const expected = buildIndex(home, scope).facts;

  const out = buildSessionStartOutput(home, { sessionId, cwd: projectPath, config });
  assert.equal(out.injected, true);

  const deliveries = readEvents(home).filter(
    (e) => e.type === "recall" && e.tool === "session-start.index",
  );
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].hits, expected);
  assert.equal(deliveries[0].session_id, sessionId);
});

test("session-start.index logs NO delivery in the control arm", (t) => {
  const home = isolatedHome(t);
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-proj-"));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  const scope = `project:${path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_-]/g, "")}`;
  const store = new Store(home);
  store.addFact(makeFact({ scope, claim: "control arm project fact one" }));
  store.close();

  const salt = "salt-control";
  const sessionId = armSession(salt, 0);
  const config = projectConfig(projectPath, salt);

  const out = buildSessionStartOutput(home, { sessionId, cwd: projectPath, config });
  assert.equal(out.reason, "control_arm");

  const deliveries = readEvents(home).filter(
    (e) => e.type === "recall" && e.tool === "session-start.index",
  );
  assert.equal(deliveries.length, 0, "control arm never logs an injection delivery");
});

test("generated-view logs delivery with the exact rendered fact ids per scope", (t) => {
  const store = isolatedStore(t);
  const a = store.addFact(makeFact({ scope: "project:demo", claim: "view fact alpha claim" }));
  const b = store.addFact(makeFact({ scope: "project:demo", claim: "view fact beta claim" }));
  renderViews(store, store.home);
  const delivery = readEvents(store.home).find(
    (e) => e.type === "recall" && e.tool === "generated-view",
  );
  assert.ok(delivery);
  assert.deepEqual([...delivery.hits].sort(), [a.id, b.id].sort());
  assert.equal(delivery.session_id, "unknown");
});

test("handoffCardFactIds returns exactly the ids the renderer shows", () => {
  const card = {
    delivered: { fact_id: "fa_delivered" },
    delta: {
      added: Array.from({ length: 7 }, (_, i) => ({ id: `fa_add_${i}` })),
      replaced: [{ old_id: "fa_old", new_id: "fa_new" }],
    },
  };
  const ids = handoffCardFactIds(card);
  assert.deepEqual(ids, [
    "fa_delivered",
    "fa_add_0", "fa_add_1", "fa_add_2", "fa_add_3", "fa_add_4", // sliced at 5
    "fa_old", "fa_new",
  ]);
});

test("writeReport logs a handoff-card delivery for the rendered facts", (t) => {
  const home = isolatedHome(t);
  const store = new Store(home);
  t.after(() => store.close());
  const now = new Date();
  const fact = store.addFact(makeFact({ scope: "project:demo", claim: "delivered handoff fact claim" }));
  // A delivery in the 1-day window makes the card have content.
  store.appendRecall({
    tool: "recall",
    hits: [fact.id],
    returned_chars: 40,
    session_id: "s-hand",
    at: new Date(now.getTime() - 60_000).toISOString(),
  });
  writeReport(store, home, {});
  const delivery = readEvents(home).find(
    (e) => e.type === "recall" && e.tool === "handoff-card",
  );
  assert.ok(delivery, "handoff-card delivery event was logged");
  assert.ok(delivery.hits.includes(fact.id));
  assert.equal(delivery.session_id, "unknown");
});

test("dashboard.graph logs delivery with the exact rendered fact node ids", async (t) => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-dash-audit-"));
  const home = path.join(userHome, ".nautli");
  const seed = new Store(home);
  const a = seed.addFact(makeFact({ scope: "project:demo", claim: "graph node one claim" }));
  const b = seed.addFact(makeFact({ scope: "project:demo", claim: "graph node two claim" }));
  seed.close();

  const started = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner: () => "ok\n",
    runDigest: () => ({ ok: true }),
  });
  t.after(async () => {
    await new Promise((resolve) => started.server.close(resolve));
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  const response = await fetch(`${started.url}/api/graph`);
  assert.equal(response.status, 200);

  const delivery = readEvents(home).find(
    (e) => e.type === "recall" && e.tool === "dashboard.graph",
  );
  assert.ok(delivery, "graph surface logged a dashboard.graph delivery");
  assert.deepEqual([...delivery.hits].sort(), [a.id, b.id].sort());
  assert.equal(delivery.session_id, "unknown");
});
