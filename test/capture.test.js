import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProjectOptedIn,
  listOptedProjects,
  setProjectOptIn,
} from "../src/capture/consent.js";
import {
  previewRedaction,
  redactText,
} from "../src/capture/redaction.js";
import {
  listSpoolEntries,
  removeSpoolEntry,
  spoolStats,
  writeSpoolEntry,
} from "../src/capture/spool.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

function isolatedHome(t, prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function runCli(home, cwd, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test("redaction removes every v1 secret kind without leaking fixture secrets", () => {
  const secrets = {
    aws: "AKIAIOSFODNN7EXAMPLE",
    github: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    // GitHub push protection이 실토큰 꼴(xoxb-숫자열)을 차단하므로 스캐너에 안 걸리는 가짜 형태를 쓴다.
    slack: "xoxb-TESTFIXTURE-NOTREAL-abcdefghijklmnop",
    pemBody: "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj",
    assignment: "correct-horse-battery-staple",
    bearer: "eyJhbGciOiJIUzI1NiJ9.secret-signature_12345",
    entropy: "q7V2m9Zx4Lp8Rk3Nw6Ty1Hs5Bc0DgFaJ",
  };
  const input = [
    `aws ${secrets.aws}`,
    `github ${secrets.github}`,
    `slack ${secrets.slack}`,
    `-----BEGIN PRIVATE KEY-----\n${secrets.pemBody}\n-----END PRIVATE KEY-----`,
    `password=${secrets.assignment}`,
    `Authorization: Bearer ${secrets.bearer}`,
    `opaque ${secrets.entropy}`,
  ].join("\n");

  const result = redactText(input);
  for (const secret of Object.values(secrets)) {
    assert.equal(result.text.includes(secret), false, secret);
  }
  assert.deepEqual(new Set(result.findings.map((finding) => finding.kind)), new Set([
    "private-key",
    "aws-key",
    "github-token",
    "slack-token",
    "bearer",
    "assignment",
    "high-entropy",
  ]));
  for (const finding of result.findings) assert.ok(finding.count >= 1);
  assert.deepEqual(previewRedaction(input), result);
});

test("redaction leaves Korean and English prose, safe code, and URL paths unchanged", () => {
  const prose = [
    "오늘 회의에서는 배포 순서와 담당자를 차분히 정리했다.",
    "The team writes clear notes and reviews them before deployment.",
    "const port = config.port ?? 3000;",
    "https://example.com/assets/q7V2m9Zx4Lp8Rk3Nw6Ty1Hs5Bc0DgFaJ",
    "한글포함q7V2m9Zx4Lp8Rk3Nw6Ty1Hs5Bc0DgFaJ",
  ].join("\n");
  assert.deepEqual(redactText(prose), { text: prose, findings: [] });
});

test("redaction closes case, whitespace, quoted-value, and entropy bypasses", () => {
  const fixtures = [
    {
      input: "aws akiaIOSFODNN7EXAMPLE",
      absent: ["akiaIOSFODNN7EXAMPLE"],
      kind: "aws-key",
    },
    {
      input: "-----BEGIN private KEY-----\nprivate body tail\n-----END private KEY-----",
      absent: ["BEGIN private KEY", "private body tail"],
      kind: "private-key",
    },
    {
      input: "github github_pat_11AA22bb33CC44dd55EE66ff77GG88hh",
      absent: ["github_pat_11AA22bb33CC44dd55EE66ff77GG88hh"],
      kind: "github-token",
    },
    {
      input: "slack XOXB-123456789012-ABCDEFGHIJKLMNOPQRSTUVWX",
      absent: ["XOXB-123456789012-ABCDEFGHIJKLMNOPQRSTUVWX"],
      kind: "slack-token",
    },
    {
      input: "Authorization: Bearer \"abc.def-123\"",
      absent: ["abc.def-123", "\"abc.def-123\""],
      kind: "bearer",
    },
    {
      input: "api_\nkey=\"correct horse battery staple\"",
      absent: ["correct horse battery staple"],
      kind: "assignment",
    },
    {
      input: "password=\"abc\\\"def secret tail\"",
      absent: ["abc\\\"def secret tail", "def secret tail"],
      kind: "assignment",
    },
    {
      input: "opaque abcdefghijklmabcdefghijklmno",
      absent: ["abcdefghijklmabcdefghijklmno"],
      kind: "high-entropy",
    },
  ];

  for (const fixture of fixtures) {
    const result = redactText(fixture.input);
    for (const secret of fixture.absent) assert.equal(result.text.includes(secret), false, secret);
    assert.equal(result.findings.some((finding) => finding.kind === fixture.kind), true);
  }
});

test("secure spool reinforces modes and writes one atomic file per entry", (t) => {
  const home = isolatedHome(t, "nautli-capture-spool-");
  const directory = path.join(home, "capture", "spool");
  fs.mkdirSync(directory, { recursive: true, mode: 0o777 });
  fs.chmodSync(directory, 0o777);

  const written = writeSpoolEntry(home, {
    session_id: "session-1",
    transcript_path: "/tmp/transcript.jsonl",
    at: "2026-07-14T00:00:00.000Z",
  });
  const file = path.join(directory, `${written.id}.json`);

  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), written);
  assert.deepEqual(listSpoolEntries(home), [written]);
  assert.equal(spoolStats(home).count, 1);
  assert.equal(fs.readdirSync(directory).some((name) => name.includes(".tmp-")), false);
  assert.equal(removeSpoolEntry(home, written.id), true);
  assert.equal(spoolStats(home).count, 0);
});

test("secure spool rejects unknown keys and oversized fields", (t) => {
  const home = isolatedHome(t, "nautli-capture-spool-guards-");

  assert.throws(
    () => writeSpoolEntry(home, { raw_transcript: "secret" }),
    (error) => error?.code === "E_INVALID_INPUT",
  );
  assert.throws(
    () => writeSpoolEntry(home, { session_id: "x".repeat(5 * 1024) }),
    (error) => error?.code === "E_INVALID_INPUT",
  );
  assert.equal(spoolStats(home).count, 0);
});

test("secure spool rejects a symlink spool directory", (t) => {
  const home = isolatedHome(t, "nautli-capture-spool-symlink-");
  const target = isolatedHome(t, "nautli-capture-spool-target-");
  fs.mkdirSync(path.join(home, "capture"), { recursive: true });
  fs.symlinkSync(target, path.join(home, "capture", "spool"), "dir");

  assert.throws(
    () => writeSpoolEntry(home, { session_id: "session-1" }),
    (error) => error?.code === "E_INVALID_INPUT",
  );
  assert.deepEqual(fs.readdirSync(target), []);
});

test("consent preserves config keys and round trips API and CLI status", (t) => {
  const home = isolatedHome(t, "nautli-capture-consent-");
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-project-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "procedure",
    custom_key: { keep: true },
  })}\n`, "utf8");

  const enabled = setProjectOptIn(home, project, true);
  assert.equal(enabled.path, fs.realpathSync(project));
  assert.equal(isProjectOptedIn(home, project), true);
  assert.equal(listOptedProjects(home)[0].enabled, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8")).custom_key, {
    keep: true,
  });

  const disabled = setProjectOptIn(home, project, false);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.opted_at, enabled.opted_at);
  assert.equal(isProjectOptedIn(home, project), false);
  assert.equal(fs.readdirSync(home).some((name) => name.includes(".tmp-")), false);

  const cliEnabled = runCli(home, project, ["capture", "on"]);
  assert.equal(cliEnabled.enabled, true);
  const status = runCli(home, root, ["capture", "status"]);
  assert.equal(status.projects.find((entry) => entry.path === fs.realpathSync(project)).enabled, true);
  const cliDisabled = runCli(home, root, ["capture", "off", project]);
  assert.equal(cliDisabled.enabled, false);
  assert.equal(runCli(home, root, ["capture", "status"]).projects[0].enabled, false);
});
