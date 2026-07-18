import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remember } from "../src/core/gate.js";
import { STATUS } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";
import { writeReport } from "../src/daemon/report.js";
import { resolveRoutedQueue } from "../src/daemon/resolve.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockResolve = path.join(root, "test", "fixtures", "mock-resolve.js");
process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";
process.env.NAUTLI_LANG = process.env.NAUTLI_LANG || "ko";
const config = {
  default_scope: "person",
  resolve_cmd: [process.execPath, mockResolve],
};

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-resolve-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

function add(store, claim, scope, tValid) {
  const result = remember(store, { claim, scope, t_valid: tValid }, config);
  return store.getFact(result.id);
}

function writeQueue(home, entries) {
  const file = path.join(home, "review", "queue.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  return file;
}

function readQueue(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);
}

function pairEntry(a, b, extra = {}) {
  return {
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    crux: "두 기록이 서로 달라요.",
    claims: { a: a.claim, b: b.claim },
    status: "routed",
    route: "machine",
    ...extra,
  };
}

test("a_wins invalidates the losing active fact", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "승자 A 설정은 켜져 있다", "project:resolve-win", "2026-07-10");
  const b = add(store, "설정은 꺼져 있다", "project:resolve-win", "2026-07-01");
  const queueFile = writeQueue(home, [pairEntry(a, b)]);

  const result = await resolveRoutedQueue(store, home, config);

  assert.deepEqual(result, {
    checked: 1,
    resolved: 1,
    remembered: 0,
    discarded: 0,
    promoted: 0,
    unresolved: 0,
  });
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(b.id).status, STATUS.INVALIDATED);
  assert.equal(store.getFact(b.id).t_invalid, a.t_valid);
  const answered = readQueue(queueFile)[0];
  assert.equal(answered.status, "answered");
  assert.equal(answered.action, "a_wins");
  assert.equal(answered.answered_by, "oracle");
  assert.match(answered.evidence, /최신 기록/u);
  const report = writeReport(store, home, {
    applied: 0,
    queued: 0,
    skipped: 0,
    oracle_resolve: result,
  });
  const reportText = fs.readFileSync(report.file, "utf8");
  assert.match(reportText, /AI가 조사해 판결 1건/u);
  assert.match(reportText, /## AI 조사 판결\n1\. a_wins: 같은 범위의 최신 기록/u);
});

test("confidence below 0.8 stays unresolved", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "낮은 확신 첫 번째 기록", "project:resolve-low", "2026-07-10");
  const b = add(store, "두 번째 기록", "project:resolve-low", "2026-07-01");
  const original = pairEntry(a, b, { route: "auto" });
  const queueFile = writeQueue(home, [original]);

  const result = await resolveRoutedQueue(store, home, config);

  assert.equal(result.unresolved, 1);
  assert.equal(result.resolved, 0);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(b.id).status, STATUS.ACTIVE);
  const routed = readQueue(queueFile)[0];
  assert.equal(routed.status, "routed");
  assert.equal(routed.route, "auto");
  assert.match(routed.evidence, /부족/u);
});

test("needs_human promotes a routed card with plain fields", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "사람 확인 첫 번째 방향", "project:resolve-human", "2026-07-10");
  const b = add(store, "두 번째 방향", "project:resolve-human", "2026-07-01");
  const queueFile = writeQueue(home, [pairEntry(a, b, { route: "hold" })]);

  const result = await resolveRoutedQueue(store, home, config);

  assert.equal(result.promoted, 1);
  const promoted = readQueue(queueFile)[0];
  assert.equal(promoted.status, "pending");
  assert.equal(promoted.promoted_by, "oracle");
  assert.equal(promoted.crux_plain, "지금 어떤 방향을 원하는지 확인이 필요해요.");
  assert.equal(promoted.context_plain, "지난 작업을 정리하다가 서로 다른 방향이 발견됐어요.");
  assert.equal(promoted.recommend, "none");
  assert.equal(promoted.recommend_reason_plain, "기록만으로는 어느 쪽이 맞는지 알기 어려워요.");
  const report = writeReport(store, home, {
    applied: 0,
    queued: 0,
    skipped: 0,
    oracle_resolve: result,
  });
  assert.match(fs.readFileSync(report.file, "utf8"), /사람으로 승격 1건/u);
});

test("pending entries are never changed", async (t) => {
  const { home, store } = isolatedStore(t);
  const a = add(store, "승자 A지만 사람이 맡은 기록", "project:resolve-sticky", "2026-07-10");
  const b = add(store, "사람이 맡은 다른 기록", "project:resolve-sticky", "2026-07-01");
  const pending = pairEntry(a, b, {
    status: "pending",
    crux_plain: "사람이 직접 확인하기로 한 질문이에요.",
  });
  const queueFile = writeQueue(home, [pending]);

  const result = await resolveRoutedQueue(store, home, config);

  assert.deepEqual(result, {
    checked: 0,
    resolved: 0,
    remembered: 0,
    discarded: 0,
    promoted: 0,
    unresolved: 0,
  });
  assert.deepEqual(readQueue(queueFile)[0], pending);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE);
  assert.equal(store.getFact(b.id).status, STATUS.ACTIVE);
});

test("cap limits the number of routed cards checked", async (t) => {
  const { home, store } = isolatedStore(t);
  const captures = Array.from({ length: 45 }, (_, index) => ({
    pair_id: `capture_${index}`,
    type: "capture",
    status: "routed",
    route: "hold",
    claim: `임시 캡처 ${index}`,
    scope: "project:resolve-cap",
    confidence: 0.7,
  }));
  const queueFile = writeQueue(home, captures);

  const result = await resolveRoutedQueue(store, home, config, { cap: 40 });

  assert.equal(result.checked, 40);
  assert.equal(result.discarded, 40);
  const queue = readQueue(queueFile);
  assert.equal(queue.filter((entry) => entry.status === "dismissed").length, 40);
  assert.equal(queue.filter((entry) => entry.status === "routed").length, 5);
  assert.equal(store.query().length, 0);
});
