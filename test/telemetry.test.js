import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { runOnce } from "../src/daemon/pipeline.js";
import {
  buildTelemetryPayload,
  isTelemetryEnabled,
  sendTelemetry,
} from "../src/daemon/telemetry.js";
import { initStore, readConfig, writeConfig } from "../src/onboard/setup.js";

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-telemetry-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

test("telemetry is off when config has no telemetry key (existing installs)", async (t) => {
  const { home, store } = isolatedStore(t);
  assert.equal(isTelemetryEnabled({}), false);
  assert.equal(isTelemetryEnabled({ default_scope: "person" }), false);

  const result = await runOnce(store, home, { triage_cmd: false, resolve_cmd: false });

  assert.deepEqual(result.telemetry, { sent: false });
});

test("new install config has telemetry enabled by default", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-new-install-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const result = initStore(home);
  assert.equal(result.first_install, true);

  const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
  assert.equal(isTelemetryEnabled(config), true);
  assert.equal(config.telemetry.enabled, true);
});

test("telemetry can be turned off via config file", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-off-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  initStore(home);
  assert.equal(isTelemetryEnabled(readConfig(home)), true);

  writeConfig(home, { telemetry: { enabled: false } });
  const after = readConfig(home);
  assert.equal(isTelemetryEnabled(after), false);
  assert.equal(after.telemetry.enabled, false);
});

test("payload only contains numeric, uuid, version, and enum values — no free text", (t) => {
  const { home, store } = isolatedStore(t);
  const payload = buildTelemetryPayload(home, store);
  const serialized = JSON.stringify(payload);

  // All string values must be UUIDs, version strings, platform enums, or numeric bucket keys
  function checkLeaves(obj, path) {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (typeof value === "object" && value !== null) {
        checkLeaves(value, fullPath);
      } else if (typeof value === "string") {
        // Allowed: UUID, semver, platform, confidence bucket keys like "0.0"-"1.0"
        const allowed = /^[0-9a-f-]{36}$/iu.test(value)
          || /^\d+\.\d+\.\d+/u.test(value)
          || ["darwin", "linux", "win32"].includes(value);
        assert.ok(allowed, `String at ${fullPath} = "${value}" must be UUID, version, or platform`);
      } else if (typeof value !== "number") {
        assert.fail(`Unexpected type at ${fullPath}: ${typeof value}`);
      }
    }
  }
  checkLeaves(payload, "");
});

test("payload never contains user supplied claim, scope, or project strings", (t) => {
  const { home, store } = isolatedStore(t);
  const secretClaim = "절대로 전송되면 안 되는 한글 기억 원문";
  const secretScope = "project:비밀프로젝트";
  const queueFile = path.join(home, "review", "queue.jsonl");
  fs.writeFileSync(queueFile, `${JSON.stringify({
    type: "capture",
    pair_id: "cap:private",
    claim: secretClaim,
    scope: secretScope,
    project: "/Users/private/비밀프로젝트",
    at: new Date().toISOString(),
    status: "pending",
  })}\n`, "utf8");

  const serialized = JSON.stringify(buildTelemetryPayload(home, store));

  assert.doesNotMatch(serialized, new RegExp(secretClaim, "u"));
  assert.doesNotMatch(serialized, /비밀프로젝트|\/Users\/private/u);
});

test("install_id is created once and retained", (t) => {
  const { home, store } = isolatedStore(t);

  const first = buildTelemetryPayload(home, store);
  const second = buildTelemetryPayload(home, store);
  const saved = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));

  assert.match(first.install_id, /^[0-9a-f-]{36}$/u);
  assert.equal(second.install_id, first.install_id);
  assert.equal(saved.telemetry.install_id, first.install_id);
});

test("send failure is swallowed and recorded as one local line", async (t) => {
  const { home } = isolatedStore(t);
  const config = {
    telemetry: { endpoint: "http://127.0.0.1:1/unreachable" },
    home,
  };

  let sent;
  await assert.doesNotReject(async () => {
    sent = await sendTelemetry({ schema_version: 1 }, config);
  });

  assert.equal(sent, false);
  const lines = fs.readFileSync(path.join(home, "daemon", "telemetry.log"), "utf8")
    .trim().split("\n");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /send_failed$/u);
});
