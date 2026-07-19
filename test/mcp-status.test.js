import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeT } from "../src/i18n/strings.js";
import { daemonStatusHeader } from "../src/mcp/server.js";

function isolatedHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-mcp-status-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function writeHealth(home, at) {
  const daemonDir = path.join(home, "daemon");
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(path.join(daemonDir, "health.log"), `${JSON.stringify({
    at,
    exit: 0,
  })}\n`, "utf8");
}

test("empty home has no daemon status lines", (t) => {
  const home = isolatedHome(t);
  const status = daemonStatusHeader(home, makeT("en"));

  assert.equal(status.lines.length, 0);
  assert.equal(status.pending, 0);
});

test("fresh digestion does not add noise", (t) => {
  const home = isolatedHome(t);
  writeHealth(home, new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());

  const status = daemonStatusHeader(home, makeT("en"));

  assert.equal(status.lines.length, 0);
});

test("stale digestion adds an action-needed status line", (t) => {
  const home = isolatedHome(t);
  writeHealth(home, new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString());

  const status = daemonStatusHeader(home, makeT("en"));

  assert.equal(status.lines.length, 1);
  assert.match(status.lines[0], /Patrol/u);
});

test("zero-touch: pending review cards no longer produce push status lines", (t) => {
  const home = isolatedHome(t);
  const reviewDir = path.join(home, "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, "queue.jsonl"), `${JSON.stringify({
    pair_id: "fact-a:fact-b",
    verdict: "duplicate",
    confidence: 0.8,
    claims: { a: "first", b: "second" },
    status: "pending",
  })}\n`, "utf8");

  const status = daemonStatusHeader(home, makeT("en"));

  // Zero-touch: no push nagging about pending cards
  assert.equal(status.pending, 0);
  assert.ok(!status.lines.some((line) => line.includes("review card")));
});
