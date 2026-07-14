import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setProjectOptIn } from "../src/capture/consent.js";
import {
  captureHookStatus,
  installCaptureHook,
  uninstallCaptureHook,
} from "../src/capture/hooks.js";
import {
  listSpoolEntries,
  spoolStats,
} from "../src/capture/spool.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");

function isolatedDirectory(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runCaptureHook(home, cwd, input) {
  return spawnSync(process.execPath, [cli, "capture-hook"], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, NAUTLI_HOME: home },
  });
}

function managedCommands(settings) {
  return (settings.hooks?.Stop ?? [])
    .flatMap((entry) => entry?.hooks ?? [entry])
    .map((hook) => hook?.command)
    .filter((command) => typeof command === "string" && command.includes("capture-hook"));
}

test("capture hook install preserves manual hooks and reinstall is idempotent", (t) => {
  const userHome = isolatedDirectory(t, "nautli-hooks-");
  const file = path.join(userHome, ".claude", "settings.json");
  const manual = {
    matcher: "",
    hooks: [{
      type: "command",
      command: "/usr/local/bin/manual-stop-hook",
    }],
  };
  const original = {
    permissions: { allow: ["Read"] },
    hooks: { Stop: [manual] },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(original, null, 2)}\n`, "utf8");

  const installed = installCaptureHook({ userHome });
  assert.equal(installed.installed, true);
  assert.equal(installed.changed, true);

  const afterInstall = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(afterInstall.hooks.Stop[0], manual);
  assert.equal(managedCommands(afterInstall).length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")), original);

  const firstContents = fs.readFileSync(file, "utf8");
  const firstBackup = fs.readFileSync(`${file}.bak`, "utf8");
  const reinstalled = installCaptureHook({ userHome });

  assert.equal(reinstalled.changed, false);
  assert.equal(fs.readFileSync(file, "utf8"), firstContents);
  assert.equal(fs.readFileSync(`${file}.bak`, "utf8"), firstBackup);
  assert.equal(captureHookStatus({ userHome }).count, 1);
});

test("capture hook uninstall removes only managed hooks", (t) => {
  const userHome = isolatedDirectory(t, "nautli-hooks-uninstall-");
  const file = path.join(userHome, ".claude", "settings.json");
  const manualCommand = "/usr/local/bin/manual-stop-hook";

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    hooks: {
      Stop: [{
        matcher: "",
        hooks: [{ type: "command", command: manualCommand }],
      }],
    },
    keep: true,
  })}\n`, "utf8");

  installCaptureHook({ userHome });
  const result = uninstallCaptureHook({ userHome });
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));

  assert.equal(result.installed, false);
  assert.equal(result.changed, true);
  assert.equal(managedCommands(settings).length, 0);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, manualCommand);
  assert.equal(settings.keep, true);

  const repeated = uninstallCaptureHook({ userHome });
  assert.equal(repeated.changed, false);
});

test("capture hook refuses to overwrite malformed settings JSON", (t) => {
  const userHome = isolatedDirectory(t, "nautli-hooks-broken-");
  const file = path.join(userHome, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{broken json\n", "utf8");

  assert.throws(
    () => installCaptureHook({ userHome }),
    /Invalid Claude settings JSON/u,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "{broken json\n");
  assert.equal(fs.existsSync(`${file}.bak`), false);
});

test("capture-hook skips a cwd without consent and exits zero", (t) => {
  const home = isolatedDirectory(t, "nautli-capture-hook-home-");
  const project = isolatedDirectory(t, "nautli-capture-hook-project-");
  const result = runCaptureHook(home, project, JSON.stringify({
    session_id: "session-no-consent",
    transcript_path: path.join(project, "missing.jsonl"),
    cwd: project,
  }));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(spoolStats(home).count, 0);
});

test("capture-hook writes one spool entry for an opted-in cwd without reading transcript", (t) => {
  const home = isolatedDirectory(t, "nautli-capture-hook-opted-home-");
  const project = isolatedDirectory(t, "nautli-capture-hook-opted-project-");
  const transcriptPath = path.join(project, "does-not-exist.jsonl");
  setProjectOptIn(home, project, true);

  const result = runCaptureHook(home, project, JSON.stringify({
    session_id: "session-opted",
    transcript_path: transcriptPath,
    cwd: project,
  }));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");

  const entries = listSpoolEntries(home);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].session_id, "session-opted");
  assert.equal(entries[0].transcript_path, transcriptPath);
  assert.equal(entries[0].project, fs.realpathSync(project));
  assert.equal(entries[0].kind, "stop");
  assert.equal(typeof entries[0].at, "string");
  assert.equal(fs.existsSync(transcriptPath), false);
});

test("capture-hook reports malformed stdin only to stderr and exits zero", (t) => {
  const home = isolatedDirectory(t, "nautli-capture-hook-invalid-home-");
  const project = isolatedDirectory(t, "nautli-capture-hook-invalid-project-");
  const result = runCaptureHook(home, project, "{not json");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.notEqual(result.stderr, "");
  assert.equal(spoolStats(home).count, 0);
});
