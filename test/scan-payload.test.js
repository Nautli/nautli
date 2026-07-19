import test from "node:test";
import assert from "node:assert/strict";
import { buildPingPayload } from "../src/scan/ping.js";

test("buildPingPayload emits only the hardcoded aggregate allowlist", () => {
  const result = {
    v: 99,
    os: "mac",
    score: 83.9,
    tools: [{ id: "claude-code", path: "/private/tool" }, { id: "cursor" }],
    totals: {
      files: 7,
      tokens: 12_345,
      alTokens: 2_345,
      path: "/private/memory.md",
      body: "secret",
    },
    findings: [{ files: ["/private/memory.md"], why: "private content" }],
    path: "/private",
    filename: "CLAUDE.md",
    body: "must not leave",
    nick: "not permitted in ping",
  };

  const payload = buildPingPayload(result);
  assert.deepEqual(payload, {
    v: 1,
    score: 83,
    tools: 2,
    tokens: 12_345,
    alTokens: 2_345,
    findings: 1,
    os: "mac",
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    "alTokens",
    "findings",
    "os",
    "score",
    "tokens",
    "tools",
    "v",
  ]);
  for (const [key, value] of Object.entries(payload)) {
    if (key === "os") assert.match(value, /^(mac|win|linux)$/u);
    else assert.equal(typeof value, "number");
  }
  assert.equal(JSON.stringify(payload).includes("private"), false);
  assert.equal(JSON.stringify(payload).includes("CLAUDE.md"), false);
  assert.equal(JSON.stringify(payload).includes("must not leave"), false);
});
