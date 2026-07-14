import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drainOnce } from "../src/capture/drain.js";
import { setProjectOptIn } from "../src/capture/consent.js";
import { installCaptureHook } from "../src/capture/hooks.js";
import { listCards } from "../src/core/review.js";
import { purgeByProvenance, Store } from "../src/core/store.js";
import { startDashboard } from "../src/dashboard/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const SECRET = "captureSecretValue_0123456789ABCDEF";

function isolatedDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function transcriptLine(role, text) {
  return JSON.stringify({
    type: role,
    message: { role, content: [{ type: "text", text }] },
  });
}

function projectTranscriptDirectory(userHome, project) {
  return path.join(
    userHome,
    ".claude",
    "projects",
    path.resolve(project).split(path.sep).join("-"),
  );
}

function fixture(t, prefix) {
  const base = isolatedDirectory(t, prefix);
  const home = path.join(base, "nautli-home");
  const userHome = path.join(base, "user-home");
  const project = path.join(userHome, "work", "nautli-project");
  const transcriptDirectory = projectTranscriptDirectory(userHome, project);
  const transcript = path.join(transcriptDirectory, "session-capture.jsonl");
  const extractor = path.join(base, "mock-extractor.js");
  const extractorInput = path.join(base, "extractor-input.txt");
  const extractorCalls = path.join(base, "extractor-calls.txt");

  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(transcriptDirectory, { recursive: true });
  fs.writeFileSync(transcript, [
    transcriptLine("user", "<system-reminder>하네스 잡음</system-reminder>"),
    transcriptLine("user", `배포 전 테스트를 실행한다. secret = ${SECRET}`),
    transcriptLine("assistant", "이 절차를 다음 세션에도 적용하겠습니다."),
    "{malformed",
  ].join("\n") + "\n", "utf8");
  fs.writeFileSync(extractor, [
    'import fs from "node:fs";',
    `const inputFile = ${JSON.stringify(extractorInput)};`,
    `const callsFile = ${JSON.stringify(extractorCalls)};`,
    'let input = "";',
    'for await (const chunk of process.stdin) input += chunk;',
    'fs.writeFileSync(inputFile, input, "utf8");',
    'fs.appendFileSync(callsFile, "1\\n", "utf8");',
    'process.stdout.write("```json\\n[{\\"claim\\":\\"배포 전에는 테스트를 실행한다.\\",\\"scope\\":\\"procedure\\",\\"confidence\\":0.93}]\\n```\\n");',
  ].join("\n"), "utf8");
  fs.mkdirSync(home, { recursive: true });
  setProjectOptIn(home, project, true);

  return {
    base,
    home,
    userHome,
    project,
    transcript,
    extractor,
    extractorInput,
    extractorCalls,
  };
}

function runHook(item) {
  return spawnSync(process.execPath, [cli, "capture-hook"], {
    cwd: item.project,
    input: JSON.stringify({
      session_id: "session-capture",
      transcript_path: item.transcript,
      cwd: item.project,
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: item.userHome,
      NAUTLI_HOME: item.home,
    },
  });
}

function runDrain(item, extraArgs = []) {
  return spawnSync(process.execPath, [cli, "capture", "drain", ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: item.userHome,
      NAUTLI_HOME: item.home,
      NAUTLI_EXTRACT_CMD: JSON.stringify([process.execPath, item.extractor]),
    },
  });
}

function filesContaining(directory, value) {
  if (!fs.existsSync(directory)) return [];
  if (!fs.statSync(directory).isDirectory()) {
    return fs.readFileSync(directory).includes(value) ? [directory] : [];
  }
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesContaining(file, value));
    else if (fs.readFileSync(file).includes(value)) found.push(file);
  }
  return found;
}

test("capture e2e creates only a pending card after hook and drain", (t) => {
  const item = fixture(t, "nautli-capture-drain-e2e-");
  const installed = installCaptureHook({ userHome: item.userHome });
  assert.equal(installed.installed, true);

  const hooked = runHook(item);
  assert.equal(hooked.status, 0, hooked.stderr);
  const drained = runDrain(item);
  assert.equal(drained.status, 0, drained.stderr);
  const result = JSON.parse(drained.stdout);
  assert.equal(result.sessions, 1);
  assert.equal(result.turns, 2);
  assert.equal(result.candidates, 1);
  assert.equal(result.malformed, 1);

  const cards = listCards(item.home);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].type, "capture");
  assert.equal(cards[0].status, "pending");
  assert.equal(cards[0].session_id, "session-capture");
  const store = new Store(item.home);
  assert.equal(store.query().length, 0);
  store.close();

  assert.equal(fs.readFileSync(item.extractorInput, "utf8").includes(SECRET), false);
  assert.match(fs.readFileSync(item.extractorInput, "utf8"), /«redacted:assignment»/u);
  for (const target of [
    path.join(item.home, "capture", "spool"),
    path.join(item.home, "capture", "checkpoints.json"),
    path.join(item.home, "review", "queue.jsonl"),
  ]) {
    assert.deepEqual(filesContaining(target, SECRET), []);
  }
});

test("checkpoint reset does not enqueue the same capture claim twice", (t) => {
  const item = fixture(t, "nautli-capture-drain-duplicate-");
  assert.equal(runHook(item).status, 0);
  assert.equal(runDrain(item).status, 0);

  const checkpointFile = path.join(item.home, "capture", "checkpoints.json");
  const checkpoints = JSON.parse(fs.readFileSync(checkpointFile, "utf8"));
  const key = fs.realpathSync(item.transcript);
  checkpoints[key] = { ...checkpoints[key], offset: 0, tail_hash: null, updated_at: null };
  fs.writeFileSync(checkpointFile, `${JSON.stringify(checkpoints)}\n`, "utf8");

  const second = runDrain(item);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).skipped_duplicates, 1);
  assert.equal(listCards(item.home).length, 1);
});

test("capture approval creates provenance and purgeByProvenance removes it", async (t) => {
  const item = fixture(t, "nautli-capture-drain-approval-");
  assert.equal(runHook(item).status, 0);
  assert.equal(runDrain(item).status, 0);
  const card = listCards(item.home)[0];
  const dashboard = await startDashboard(item.home, {
    port: 0,
    open: false,
    userHome: item.userHome,
  });
  t.after(() => new Promise((resolve) => dashboard.server.close(resolve)));

  const response = await fetch(`${dashboard.url}/api/cards/${encodeURIComponent(card.pair_id)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: dashboard.url,
    },
    body: JSON.stringify({ action: "remember" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);

  const store = new Store(item.home);
  const facts = store.query();
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].provenance, {
    session_id: "session-capture",
    project: fs.realpathSync(item.project),
    source: "capture",
  });
  const purged = purgeByProvenance(
    store,
    (provenance) => provenance.source === "capture"
      && provenance.session_id === "session-capture",
  );
  assert.equal(purged.purged, 1);
  assert.equal(store.query().length, 0);
  assert.equal(
    fs.readFileSync(path.join(item.home, "review", "queue.jsonl"), "utf8").includes(facts[0].claim),
    false,
  );
  store.close();
});

test("capture dry run does not call extractor or mutate queue", async (t) => {
  const item = fixture(t, "nautli-capture-drain-dry-");
  assert.equal(runHook(item).status, 0);
  const queueFile = path.join(item.home, "review", "queue.jsonl");
  const before = fs.existsSync(queueFile) ? fs.readFileSync(queueFile, "utf8") : null;
  let calls = 0;

  const result = await drainOnce(item.home, { user_home: item.userHome }, {
    dry: true,
    extractor: async () => {
      calls += 1;
      return [];
    },
  });

  assert.equal(result.sessions, 1);
  assert.equal(result.turns, 2);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(queueFile) ? fs.readFileSync(queueFile, "utf8") : null, before);
  assert.equal(fs.existsSync(path.join(item.home, "capture", "checkpoints.json")), false);
});

test("drain surfaces extractor truncation in its result", async (t) => {
  const item = fixture(t, "nautli-capture-drain-truncated-");
  assert.equal(runHook(item).status, 0);

  const result = await drainOnce(item.home, { user_home: item.userHome }, {
    extractor: async () => ({
      candidates: [{ claim: "절단 보고 검증용 기억이다.", scope: "procedure", confidence: 0.8 }],
      truncated: true,
    }),
  });

  assert.equal(result.candidates, 1);
  assert.equal(result.truncated, 1);
});

test("drain reprocesses transcript bytes appended after a prior drain", (t) => {
  const item = fixture(t, "nautli-capture-drain-append-");
  assert.equal(runHook(item).status, 0);
  const first = JSON.parse(runDrain(item).stdout);
  assert.equal(first.candidates, 1);

  fs.appendFileSync(item.transcript, [
    transcriptLine("user", "추가된 새 결정: 캡처 후보는 자동 승격하지 않는다."),
    transcriptLine("assistant", "그 원칙을 지키겠습니다."),
  ].join("\n") + "\n", "utf8");
  fs.writeFileSync(item.extractorCalls, "", "utf8");

  const second = JSON.parse(runDrain(item).stdout);
  assert.equal(second.sessions, 1, "append 이후 새 바이트가 재처리돼야 한다");
  assert.equal(second.turns, 2);
});

test("concurrent drainOnce lets only one run proceed", async (t) => {
  const item = fixture(t, "nautli-capture-drain-lock-");
  assert.equal(runHook(item).status, 0);
  const slowExtractor = async (text) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return [{ claim: "동시성 잠금 검증 기억이다.", scope: "procedure", confidence: 0.8 }];
  };
  const [a, b] = await Promise.all([
    drainOnce(item.home, { user_home: item.userHome }, { extractor: slowExtractor }),
    drainOnce(item.home, { user_home: item.userHome }, { extractor: slowExtractor }),
  ]);
  const running = [a, b].filter((r) => r.already_running === true);
  assert.equal(running.length, 1, "동시 실행 중 하나는 already_running이어야 한다");
});

test("capture hook ignores stdin above the size limit and writes no spool entry", (t) => {
  const item = fixture(t, "nautli-capture-drain-oversize-");
  const oversize = "x".repeat(17 * 1024);
  const result = spawnSync(process.execPath, [cli, "capture-hook"], {
    cwd: item.project,
    input: oversize,
    encoding: "utf8",
    env: { ...process.env, HOME: item.userHome, NAUTLI_HOME: item.home },
  });
  assert.equal(result.status, 0);
  const spoolDir = path.join(item.home, "capture", "spool");
  const entries = fs.existsSync(spoolDir) ? fs.readdirSync(spoolDir) : [];
  assert.equal(entries.length, 0);
});
