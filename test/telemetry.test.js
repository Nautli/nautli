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

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-telemetry-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

test("telemetry is off by default and the pipeline does not build a payload", async (t) => {
  const { home, store } = isolatedStore(t);
  assert.equal(isTelemetryEnabled({}), false);

  const result = await runOnce(store, home, { triage_cmd: false, resolve_cmd: false });

  assert.deepEqual(result.telemetry, { sent: false });
  assert.equal(fs.existsSync(path.join(home, "config.json")), false);
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
