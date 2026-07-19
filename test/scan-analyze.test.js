import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  estimateMonthlyUsd,
  gradeForScore,
} from "../src/scan/analyze.js";

test("analyze applies cross-tool, always-loaded, score, grade, and monthly formulas", () => {
  const shared = "가".repeat(2_000);
  const result = analyze([
    {
      tool: "claude-code",
      path: "/fixture/claude/CLAUDE.md",
      name: "CLAUDE.md",
      body: shared,
      size: 6_000,
      modified: Date.now(),
    },
    {
      tool: "codex",
      path: "/fixture/codex/AGENTS.md",
      name: "AGENTS.md",
      body: shared,
      size: 6_000,
      modified: Date.now(),
    },
  ], { os: "mac", lang: "ko" });

  assert.equal(result.v, 1);
  assert.equal(result.os, "mac");
  assert.equal(result.totals.files, 2);
  assert.equal(result.totals.tokens, 4_000);
  assert.equal(result.totals.alTokens, 4_000);
  assert.equal(result.findings.filter((finding) => finding.group === "alwaysLoaded").length, 2);
  assert.equal(result.findings[0].group, "crossTool");
  assert.equal(result.findings[0].weight, 3);
  assert.equal(result.score, 72);
  assert.equal(result.grade, "B");
  assert.equal(result.estMonthlyUsd, 3.6);
});

test("grade and estimated monthly cost match the schema boundaries", () => {
  assert.equal(gradeForScore(90), "S");
  assert.equal(gradeForScore(78), "A");
  assert.equal(gradeForScore(65), "B");
  assert.equal(gradeForScore(50), "C");
  assert.equal(gradeForScore(49), "F");
  assert.equal(estimateMonthlyUsd(1_000_000), 900);
});
