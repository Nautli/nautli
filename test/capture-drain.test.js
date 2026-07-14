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
    'process.stdout.write("
