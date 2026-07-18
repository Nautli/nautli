import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDaemon } from "../src/cli.js";
import { remember } from "../src/core/gate.js";
import {
  consumeSpool,
  readSpool,
  touchSpool,
} from "../src/core/spool.js";
import { Store } from "../src/core/store.js";
import {
  installDaemon,
  notifyDigestResult,
} from "../src/onboard/setup.js";

const config = { default_scope: "person", patrol: { settle_ms: 0 } };

function isolatedHome(t, prefix = "nautli-spool-") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test("spool markers report newest mtime and consume includes the boundary", (t) => {
  const home = isolatedHome(t);
  touchSpool(home);
  let markers = fs.readdirSync(path.join(home, "daemon", "spool"));
  assert.equal(markers.length, 1);
  const first = path.join(home, "daemon", "spool", markers[0]);
  fs.utimesSync(first, new Date(1_000), new Date(1_000));

  touchSpool(home);
  markers = fs.readdirSync(path.join(home, "daemon", "spool"));
  const second = markers.map((name) => path.join(home, "daemon", "spool", name))
    .find((file) => file !== first);
  fs.utimesSync(second, new Date(2_000), new Date(2_000));

  const snapshot = readSpool(home);
  assert.equal(snapshot.count, 2);
  assert.equal(snapshot.newest_at, 2_000);
  // 이름 스냅샷 소비 — 지정한 marker만 지우고 나머지는 남긴다 (시계 비의존).
  assert.equal(consumeSpool(home, [path.basename(first)]), 1);
  const after = readSpool(home);
  assert.equal(after.count, 1);
  assert.equal(after.newest_at, 2_000);
  assert.deepEqual(after.names, [path.basename(second)]);
});

test("remember touches spool only when a fact is added, including supersedes", (t) => {
  const home = isolatedHome(t);
  const store = new Store(home);
  t.after(() => store.close());

  const added = remember(store, { claim: "배포 포트는 3000", scope: "project:spool" }, config);
  assert.equal(added.status, "added");
  assert.equal(readSpool(home).count, 1);

  const duplicate = remember(store, { claim: "배포 포트는 3000!", scope: "project:spool" }, config);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(readSpool(home).count, 1);

  const rejected = remember(store, { claim: "", scope: "project:spool" }, config);
  assert.equal(rejected.status, "rejected");
  assert.equal(readSpool(home).count, 1);

  const superseding = remember(store, {
    claim: "배포 포트는 4000",
    scope: "project:spool",
    supersedes: added.id,
  }, config);
  assert.equal(superseding.status, "added");
  assert.equal(readSpool(home).count, 2);
});

test("runDaemon keeps the freshness gate for patrols and bypasses it for spool", async (t) => {
  const home = isolatedHome(t);
  const health = path.join(home, "daemon", "health.log");
  fs.mkdirSync(path.dirname(health), { recursive: true });
  fs.writeFileSync(health, `${JSON.stringify({ at: new Date().toISOString(), exit: 0 })}\n`, "utf8");
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify(config)}\n`, "utf8");

  let digests = 0;
  const dependencies = {
    digestRunner: async () => { digests += 1; return { ok: true, applied: 0 }; },
    notifier: () => ({ notified: false }),
    now: () => Date.now() + 1_000,
  };
  const patrol = await runDaemon(home, [], dependencies);
  assert.equal(patrol.result.skipped_run, true);
  assert.equal(patrol.result.trigger, "patrol");
  assert.equal(digests, 0);

  touchSpool(home);
  const event = await runDaemon(home, [], dependencies);
  assert.equal(event.result.ok, true);
  assert.equal(event.result.trigger, "spool");
  assert.equal(digests, 1);
  assert.equal(readSpool(home).count, 0);
});

test("runDaemon repeats for markers created during digestion and caps at three cycles", async (t) => {
  const home = isolatedHome(t);
  let pending = 1;
  let digests = 0;
  let consumed = 0;
  const result = await runDaemon(home, [], {
    configReader: () => config,
    spoolReader: () => ({ count: pending, newest_at: 0 }),
    spoolConsumer: () => { pending -= 1; consumed += 1; return 1; },
    digestRunner: async () => {
      digests += 1;
      pending += 1; // runStart 이후 새 remember가 들어온 상황
      return { ok: true, applied: 1 };
    },
    notifier: () => ({ notified: false }),
    now: () => 10_000 + digests,
  });

  assert.equal(result.result.trigger, "spool");
  assert.equal(digests, 3);
  assert.equal(consumed, 3);
  assert.equal(pending, 1);
});

test("digest notifications cap success and failure independently and carry accumulation", (t) => {
  const home = isolatedHome(t);
  const calls = [];
  const runner = (command, args) => { calls.push([command, args]); return ""; };
  const options = (now, extra = {}) => ({
    home,
    now,
    platform: "darwin",
    runner,
    locale: "ko",
    config: {},
    ...extra,
  });
  const dayOne = new Date(2026, 6, 18, 9, 0, 0);
  const dayTwo = new Date(2026, 6, 19, 9, 0, 0);

  assert.equal(notifyDigestResult({ ok: true, applied: 2 }, options(dayOne)).notified, true);
  const capped = notifyDigestResult({ ok: true, applied: 3 }, options(dayOne));
  assert.deepEqual(capped, { notified: false, reason: "daily_cap" });
  assert.deepEqual(
    notifyDigestResult({ ok: true, applied: 0 }, options(dayOne)),
    { notified: false, reason: "no_changes" },
  );

  assert.equal(notifyDigestResult({ ok: true, applied: 4 }, options(dayTwo)).notified, true);
  assert.ok(calls[1][1][calls[1][1].length - 2].includes("7"));

  assert.equal(notifyDigestResult({ ok: false }, options(dayTwo)).notified, true);
  assert.deepEqual(
    notifyDigestResult({ ok: false }, options(dayTwo)),
    { notified: false, reason: "daily_cap" },
  );

  const beforeDisabled = calls.length;
  assert.deepEqual(
    notifyDigestResult(
      { ok: true, applied: 9 },
      options(dayTwo, { config: { notifications: false } }),
    ),
    { notified: false, reason: "disabled" },
  );
  assert.equal(calls.length, beforeDisabled);
});

test("daemon plist watches the escaped spool path with launchd throttling", (t) => {
  const userHome = isolatedHome(t, "nautli-plist-user-");
  const home = path.join(userHome, ".nautli&events");
  const result = installDaemon(home, () => "", { userHome, uid: 501 });
  const plist = fs.readFileSync(result.plist, "utf8");

  assert.match(plist, /<key>WatchPaths<\/key><array>/u);
  assert.ok(plist.includes(`${home.replaceAll("&", "&amp;")}/daemon/spool`));
  assert.match(plist, /<key>ThrottleInterval<\/key><integer>60<\/integer>/u);
  assert.match(plist, /<key>StartCalendarInterval<\/key>/u);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/u);
});
