import test from "node:test";
import assert from "node:assert/strict";
import { assertNtKey } from "../site/api/_kv.js";
import {
  estimateMonthlyUsd,
  gradeForScore,
  percentileFromHistogram,
  sanitizeNick,
  validatePingPayload,
  validateSharePayload,
} from "../site/api/_validate.js";

const valid = {
  v: 1,
  score: 20,
  tools: 0,
  tokens: 0,
  alTokens: 0,
  findings: 0,
  os: "mac",
};

test("ping validation accepts every numeric boundary", () => {
  assert.equal(validatePingPayload(valid).ok, true);
  // v2 scoring has no floor — low scores are valid data, not schema violations.
  assert.equal(validatePingPayload({ ...valid, score: 0 }).ok, true);
  assert.equal(validatePingPayload({ ...valid, score: 5 }).ok, true);
  assert.equal(validatePingPayload({ ...valid, score: 19 }).ok, true);
  assert.equal(validatePingPayload({
    ...valid,
    score: 100,
    tools: 20,
    tokens: 10_000_000,
    alTokens: 10_000_000,
    findings: 500,
    os: "linux",
  }).ok, true);
});

test("ping validation rejects values outside the schema", () => {
  for (const payload of [
    { ...valid, v: 2 },
    { ...valid, score: -1 },
    { ...valid, score: 101 },
    { ...valid, score: 20.5 },
    { ...valid, tools: 21 },
    { ...valid, tokens: 10_000_001 },
    { ...valid, alTokens: 1 },
    { ...valid, findings: 501 },
    { ...valid, os: "darwin" },
  ]) {
    assert.equal(validatePingPayload(payload).ok, false);
  }
});

test("ping and share reject fields outside their allowlists", () => {
  assert.equal(validatePingPayload({ ...valid, nick: "nautli" }).ok, false);
  assert.equal(validatePingPayload({ ...valid, path: "/private/CLAUDE.md" }).ok, false);
  assert.equal(validateSharePayload({ ...valid, grade: "S" }).ok, false);
  assert.equal(validateSharePayload({ ...valid, percentile: 99 }).ok, false);
  assert.equal(validateSharePayload({ ...valid, estMonthlyUsd: 0 }).ok, false);
});

test("share validation sanitizes and truncates nick without mutating input", () => {
  const payload = { ...valid, nick: "나우틀리🚀 user.name_123456789" };
  const before = structuredClone(payload);
  const result = validateSharePayload(payload);
  assert.equal(result.ok, true);
  assert.equal(result.value.nick, "나우틀리 user.name_12345");
  assert.deepEqual(payload, before);
  assert.equal(validateSharePayload({ ...valid, nick: 123 }).ok, false);
  assert.equal(sanitizeNick("a/b\\c@d"), "abcd");
});

test("server-derived grade and monthly estimate use the schema formulas", () => {
  assert.equal(gradeForScore(90), "S");
  assert.equal(gradeForScore(78), "A");
  assert.equal(gradeForScore(65), "B");
  assert.equal(gradeForScore(50), "C");
  assert.equal(gradeForScore(49), "F");
  assert.equal(estimateMonthlyUsd(1_000_000), 900);
});

test("percentile is null for an empty or self-only histogram", () => {
  assert.deepEqual(percentileFromHistogram({}, 80), { count: 0, percentile: null });
  assert.deepEqual(percentileFromHistogram({ 80: 1 }, 80), { count: 1, percentile: null });
  assert.deepEqual(percentileFromHistogram({ 70: 1, 80: 1 }, 80), {
    count: 2,
    percentile: 50,
  });
});

test("KV guard permits only the nt namespace", () => {
  assert.equal(assertNtKey("nt:hist"), "nt:hist");
  assert.throws(() => assertNtKey("cc:hist"), /nt: prefix/u);
  assert.throws(() => assertNtKey("spv:hist"), /nt: prefix/u);
  assert.throws(() => assertNtKey("hist"), /nt: prefix/u);
});
