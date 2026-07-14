import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  advanceCheckpoint,
  checkpointFor,
  loadCheckpoints,
  saveCheckpoints,
} from "../src/capture/checkpoint.js";
import {
  formatDelta,
  parseTurns,
  readDelta,
  sizeStable,
} from "../src/capture/transcript.js";

function isolatedDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function transcriptLine(role, text, extra = {}) {
  return JSON.stringify({
    type: role,
    message: {
      role,
      content: [{ type: "text", text }],
    },
    ...extra,
  });
}

test("readDelta carries a partial line into the next read", (t) => {
  const directory = isolatedDirectory(t, "nautli-transcript-partial-");
  const file = path.join(directory, "session.jsonl");
  const first = `${transcriptLine("user", "첫 줄")}\n`;
  const second = transcriptLine("assistant", "아직 미완성");
  fs.writeFileSync(file, first + second, "utf8");

  const initial = readDelta(file, 0);
  assert.equal(initial.nextOffset, Buffer.byteLength(first));
  assert.equal(initial.lines.length, 1);
  assert.equal(initial.malformed, 0);
  assert.equal(parseTurns(initial.lines)[0].text, "첫 줄");

  fs.appendFileSync(file, "\n", "utf8");
  const carried = readDelta(file, initial.nextOffset);
  assert.equal(carried.nextOffset, Buffer.byteLength(`${first}${second}\n`));
  assert.equal(carried.lines.length, 1);
  assert.equal(parseTurns(carried.lines)[0].text, "아직 미완성");
});

test("checkpointFor resets after truncation", (t) => {
  const directory = isolatedDirectory(t, "nautli-checkpoint-truncate-");
  const file = path.join(directory, "session.jsonl");
  const first = `${transcriptLine("user", "alpha")}\n`;
  const second = `${transcriptLine("assistant", "beta")}\n`;
  fs.writeFileSync(file, first + second, "utf8");

  const checkpoints = {};
  const delta = readDelta(file, 0);
  advanceCheckpoint(checkpoints, file, delta);
  assert.equal(checkpointFor(checkpoints, file).offset, delta.nextOffset);

  fs.truncateSync(file, Buffer.byteLength(first));
  assert.equal(checkpointFor(checkpoints, file).offset, 0);
});

test("checkpointFor resets when the previous complete line hash changes", (t) => {
  const directory = isolatedDirectory(t, "nautli-checkpoint-tail-");
  const file = path.join(directory, "session.jsonl");
  const original = `${transcriptLine("user", "alpha")}\n`;
  const changed = `${transcriptLine("user", "omega")}\n`;
  assert.equal(Buffer.byteLength(original), Buffer.byteLength(changed));
  fs.writeFileSync(file, original, "utf8");

  const checkpoints = {};
  const delta = readDelta(file, 0);
  advanceCheckpoint(checkpoints, file, delta);
  fs.writeFileSync(file, changed, "utf8");

  assert.equal(checkpointFor(checkpoints, file).offset, 0);
  assert.equal(checkpointFor(checkpoints, file).tail_hash, null);
});

test("checkpoint save is atomic and reloads realpath keys", (t) => {
  const home = isolatedDirectory(t, "nautli-checkpoint-home-");
  const file = path.join(home, "session.jsonl");
  fs.writeFileSync(file, `${transcriptLine("user", "저장")}\n`, "utf8");

  const checkpoints = {};
  advanceCheckpoint(checkpoints, file, readDelta(file, 0));
  saveCheckpoints(home, checkpoints);

  const loaded = loadCheckpoints(home);
  const key = fs.realpathSync(file);
  assert.deepEqual(loaded[key], checkpoints[key]);
  assert.equal(
    fs.readdirSync(path.join(home, "capture"))
      .some((name) => name.includes(".tmp-")),
    false,
  );
});

test("parseTurns excludes harness noise, metadata, and tool payloads", () => {
  const records = [
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "<system-reminder>ignore this</system-reminder>" }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "[SYSTEM NOTIFICATION task finished" }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "<task-notification>noise</task-notification>" }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "<command-name>review</command-name>" }],
      },
    },
    {
      type: "user",
      isMeta: true,
      message: {
        role: "user",
        content: [{ type: "text", text: "meta text" }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", content: "raw tool output" },
          { type: "text", text: "실제 사용자 질문" },
        ],
      },
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/secret" } },
          { type: "text", text: "실제 답변" },
        ],
      },
    },
    {
      type: "progress",
      message: {
        role: "assistant",
        content: "진행 이벤트",
      },
    },
  ];

  const turns = parseTurns(records);
  assert.deepEqual(turns, [
    { role: "user", text: "실제 사용자 질문" },
    { role: "assistant", text: "실제 답변" },
  ]);
  assert.equal(formatDelta(turns), "유저: 실제 사용자 질문\nAI: 실제 답변");
  assert.equal(formatDelta(turns).includes("raw tool output"), false);
  assert.equal(formatDelta(turns).includes("/secret"), false);
});

test("readDelta counts malformed complete JSON lines", (t) => {
  const directory = isolatedDirectory(t, "nautli-transcript-malformed-");
  const file = path.join(directory, "session.jsonl");
  fs.writeFileSync(
    file,
    `${transcriptLine("user", "valid")}\n{malformed json\n${transcriptLine("assistant", "also valid")}\n`,
    "utf8",
  );

  const delta = readDelta(file, 0);
  assert.equal(delta.lines.length, 2);
  assert.equal(delta.malformed, 1);
  assert.deepEqual(
    parseTurns(delta.lines).map((turn) => turn.text),
    ["valid", "also valid"],
  );
});

test("readDelta does not decode an incomplete Korean UTF-8 sequence", (t) => {
  const directory = isolatedDirectory(t, "nautli-transcript-utf8-");
  const file = path.join(directory, "session.jsonl");
  const completeLine = Buffer.from(`${transcriptLine("user", "한글 경계 안전")}\n`, "utf8");
  const hangulStart = completeLine.indexOf(Buffer.from("한", "utf8"));
  const split = hangulStart + 1;

  fs.writeFileSync(file, completeLine.subarray(0, split));
  const partial = readDelta(file, 0);
  assert.equal(partial.lines.length, 0);
  assert.equal(partial.nextOffset, 0);
  assert.equal(partial.malformed, 0);

  fs.appendFileSync(file, completeLine.subarray(split));
  const finished = readDelta(file, partial.nextOffset);
  assert.equal(finished.malformed, 0);
  assert.deepEqual(parseTurns(finished.lines), [
    { role: "user", text: "한글 경계 안전" },
  ]);
  assert.equal(formatDelta(parseTurns(finished.lines)), "유저: 한글 경계 안전");
});

test("sizeStable accepts an injected interval", async (t) => {
  const directory = isolatedDirectory(t, "nautli-transcript-stable-");
  const file = path.join(directory, "session.jsonl");
  fs.writeFileSync(file, "stable\n", "utf8");

  assert.equal(await sizeStable(file, { intervalMs: 1 }), true);
});
