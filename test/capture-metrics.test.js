import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_THRESHOLDS,
  captureMetrics,
  evaluateVerdict,
} from "../src/capture/metrics.js";
import { applyCaptureCard } from "../src/core/review.js";
import { Store } from "../src/core/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

function isolatedHome(t, prefix = "nautli-capture-metrics-") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(home, "events"), { recursive: true });
  fs.mkdirSync(path.join(home, "review"), { recursive: true });
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function writeJsonl(file, entries) {
  fs.writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
}

function syntheticFixture(t) {
  const home = isolatedHome(t);
  const start = Date.parse("2025-01-01T00:00:00.000Z");
  const cards = [];
  const actions = [
    ...Array(12).fill("remember"),
    ...Array(6).fill("dismissed"),
    ...Array(2).fill("deferred"),
    ...Array(3).fill(undefined),
  ];
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    cards.push({
      type: "capture",
      pair_id: `cap:${index + 1}`,
      claim: `리포트에 나오면 안 되는 캡처 원문 ${index + 1}`,
      claim_hash: `hash-${index + 1}`,
      scope: "project:metrics",
      confidence: 0.9,
      session_id: index % 2 === 0 ? "session-secret-a" : "session-secret-b",
      project: "/private/secret/project",
      at: new Date(start).toISOString(),
      status: action === undefined ? "pending" : action === "remember" ? "answered" : action,
      ...(action === undefined ? {} : {
        action,
        handled_at: new Date(start + (index + 1) * 1000).toISOString(),
      }),
      ...(action === "remember" ? { fact_id: `auto-${index + 1}` } : {}),
    });
  }
  writeJsonl(path.join(home, "review", "queue.jsonl"), cards);

  const events = [];
  for (let index = 1; index <= 12; index += 1) {
    events.push({
      ev: "fact.added",
      at: "2025-01-02T00:00:00.000Z",
      fact: {
        id: `auto-${index}`,
        claim: `리포트에 나오면 안 되는 자동 원문 ${index}`,
        provenance: {
          source: "capture",
          session_id: "fact-session-secret",
          project: "/private/secret/project",
        },
      },
    });
  }
  for (let index = 1; index <= 10; index += 1) {
    events.push({
      ev: "fact.added",
      at: "2025-01-02T00:00:00.000Z",
      fact: {
        id: `explicit-${index}`,
        claim: `리포트에 나오면 안 되는 직접 원문 ${index}`,
        provenance: { source: "cli" },
      },
    });
  }
  for (let index = 0; index < 15; index += 1) {
    events.push({
      type: "recall",
      source: "cli",
      at: new Date(start + (index + 1) * 86_400_000).toISOString(),
      hits: [
        `auto-${(index % 6) + 1}`,
        `explicit-${(index % 5) + 1}`,
        ...(index < 3 ? [`auto-${index + 1}`] : []),
      ],
    });
  }
  writeJsonl(path.join(home, "events", "2025-01.jsonl"), events);
  return home;
}

test("captureMetrics reports exact cohort metrics without leaking source content", (t) => {
  const home = syntheticFixture(t);
  const report = captureMetrics(home, { now: "2025-01-21T00:00:00.000Z" });

  assert.deepEqual(report.metrics.auto, {
    candidates: 23,
    approved: 12,
    dismissed: 6,
    deferred: 2,
    pending: 3,
    approval_rate: 2 / 3,
    false_positive_rate: 1 / 3,
    median_review_latency_ms: 10_500,
    facts: 12,
    recalled_facts: 6,
    useful_recall_rate: 0.5,
    recall_refs_per_fact: 1.5,
  });
  assert.deepEqual(report.metrics.explicit, {
    facts: 10,
    recalled_facts: 5,
    useful_recall_rate: 0.5,
    recall_refs_per_fact: 1.5,
  });
  assert.deepEqual(report.metrics.comparison, { useful_recall_delta: 0 });
  assert.deepEqual(report.sample, {
    decided_cards: 20,
    auto_facts: 12,
    explicit_facts: 10,
    recall_events: 15,
    capture_sessions: 2,
    first_capture_at: "2025-01-01T00:00:00.000Z",
    window_days: 20,
  });
  assert.equal(report.verdict, "PASS");

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /리포트에 나오면 안 되는/u);
  assert.doesNotMatch(serialized, /private\/secret|session-secret|fact-session-secret/u);
  assert.doesNotMatch(serialized, /"claim"|"project"|"session_id"/u);
});

test("zero denominators stay null", (t) => {
  const home = isolatedHome(t, "nautli-capture-metrics-empty-");
  writeJsonl(path.join(home, "review", "queue.jsonl"), [{
    type: "capture",
    pair_id: "cap:pending",
    status: "pending",
    at: "2025-01-01T00:00:00.000Z",
  }]);
  const report = captureMetrics(home, { now: "2025-01-01T00:00:00.000Z" });
  assert.equal(report.metrics.auto.approval_rate, null);
  assert.equal(report.metrics.auto.false_positive_rate, null);
  assert.equal(report.metrics.auto.median_review_latency_ms, null);
  assert.equal(report.metrics.auto.useful_recall_rate, null);
  assert.equal(report.metrics.auto.recall_refs_per_fact, null);
  assert.equal(report.metrics.explicit.useful_recall_rate, null);
  assert.equal(report.metrics.explicit.recall_refs_per_fact, null);
  assert.equal(report.metrics.comparison.useful_recall_delta, null);
});

test("evaluateVerdict reproduces insufficient, pass, and kill with sample gate first", () => {
  const goodMetrics = {
    auto: {
      approval_rate: 0.6,
      false_positive_rate: 0.4,
      useful_recall_rate: 0.3,
    },
    explicit: { useful_recall_rate: 0.5 },
  };
  assert.equal(evaluateVerdict({
    sample: { decided_cards: 19, recall_events: 9 },
    metrics: {
      auto: { approval_rate: 0, false_positive_rate: 1, useful_recall_rate: 0 },
      explicit: { useful_recall_rate: 1 },
    },
  }), "INSUFFICIENT_SAMPLE");
  assert.equal(evaluateVerdict({
    sample: { decided_cards: 20, recall_events: 10 },
    metrics: goodMetrics,
  }), "PASS");
  assert.equal(evaluateVerdict({
    sample: { decided_cards: 20, recall_events: 10 },
    metrics: goodMetrics,
  }, { ...DEFAULT_THRESHOLDS, approval_rate: 0.7 }), "KILL");
});

test("capture metrics CLI prints the human table and the report JSON", (t) => {
  const home = syntheticFixture(t);
  const run = (args) => spawnSync(process.execPath, [cli, "capture", "metrics", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
  const human = run([]);
  assert.equal(human.status, 0, human.stderr || human.stdout);
  assert.match(human.stdout, /\[통과\].*자동 캡처 계측/u);
  assert.match(human.stdout, /승인율.*66\.7%/u);
  assert.match(human.stdout, /유용 회상률.*50\.0%.*50\.0%/u);

  const json = run(["--json"]);
  assert.equal(json.status, 0, json.stderr || json.stdout);
  const report = JSON.parse(json.stdout);
  assert.equal(report.kind, "capture-metrics");
  assert.equal(report.metrics.auto.approved, 12);
  assert.equal(report.verdict, "PASS");
});

test("capture metrics CLI renders the insufficient-sample path honestly", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-metrics-empty-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const run = (args) => spawnSync(process.execPath, [cli, "capture", "metrics", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
  const human = run([]);
  assert.equal(human.status, 0, human.stderr || human.stdout);
  assert.match(human.stdout, /\[표본 부족\]/u);
  assert.match(human.stdout, /승인율\s+측정 전/u);
  assert.match(human.stdout, /카드 결정 \d+건·회상 \d+건을 더 채우면 판정/u);

  const report = JSON.parse(run(["--json"]).stdout);
  assert.equal(report.verdict, "INSUFFICIENT_SAMPLE");
  assert.equal(report.metrics.auto.approval_rate, null);
  assert.equal(report.metrics.auto.recall_refs_per_fact, null);
});

test("capture decisions are logged once per action and rebuild never treats them as facts", (t) => {
  const home = isolatedHome(t, "nautli-capture-decided-");
  const store = new Store(home);
  t.after(() => store.close());
  const createdAt = new Date(Date.now() - 1000).toISOString();
  writeJsonl(path.join(home, "review", "queue.jsonl"), [
    {
      type: "capture",
      pair_id: "cap:remember",
      claim: "결정 이벤트 기억 원문",
      scope: "person",
      confidence: 0.8,
      session_id: "private-session",
      project: "/private/project",
      at: createdAt,
      status: "pending",
    },
    {
      type: "capture",
      pair_id: "cap:dismissed",
      claim: "결정 이벤트 버림 원문",
      scope: "person",
      confidence: 0.7,
      at: createdAt,
      status: "pending",
    },
    {
      type: "capture",
      pair_id: "cap:deferred",
      claim: "결정 이벤트 미룸 원문",
      scope: "person",
      confidence: 0.6,
      at: createdAt,
      status: "pending",
    },
  ]);

  applyCaptureCard(store, home, "cap:remember", "remember", { default_scope: "person" });
  applyCaptureCard(store, home, "cap:dismissed", "dismissed", { default_scope: "person" });
  applyCaptureCard(store, home, "cap:deferred", "deferred", { default_scope: "person" });
  const eventFiles = fs.readdirSync(path.join(home, "events"))
    .filter((file) => file.endsWith(".jsonl"));
  const events = eventFiles.flatMap((file) => fs.readFileSync(path.join(home, "events", file), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line)));
  const decided = events.filter((event) => event.ev === "capture.decided");
  assert.deepEqual(decided.map((event) => event.action), ["remember", "dismissed", "deferred"]);
  assert.equal(decided.every((event) => event.latency_ms >= 0), true);
  assert.equal(decided.some((event) => Object.hasOwn(event, "claim")), false);

  const before = store.stats().total;
  assert.equal(before, 1);
  store.rebuild();
  assert.equal(store.stats().total, before);
});
