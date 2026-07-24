import test from "node:test";
import assert from "node:assert/strict";
import { analyze, gradeForScore } from "../src/scan/analyze.js";

/* ══════════════════════════════════════════════════════════════════════
   Synthetic fixtures — each represents a distinct vault archetype.
   "First scan mostly C~B, fixing the top finding yields visible gain."
   ══════════════════════════════════════════════════════════════════════ */

function makeDoc(overrides) {
  const base = {
    tool: "claude-code",
    path: `/fixture/${overrides.name || "file.md"}`,
    name: overrides.name || "file.md",
    body: overrides.body || "a".repeat(200),
    size: overrides.size ?? 1_000,
    modified: overrides.modified ?? Date.now(),
  };
  return { ...base, ...overrides, path: overrides.path ?? base.path };
}

// 1. Clean small vault — few files, small CLAUDE.md
function fixtureCleanSmall() {
  return [
    makeDoc({ name: "CLAUDE.md", body: "Rules: be concise.\n\n" + "x".repeat(800), size: 900 }),
    makeDoc({ name: "notes.md", body: "Meeting notes from yesterday.\n\n" + "y".repeat(300), size: 400 }),
    makeDoc({ name: "todo.md", body: "Ship the feature.\n\n" + "z".repeat(200), size: 300 }),
  ];
}

// 2. Bloated CLAUDE.md only — single massive always-loaded file
function fixtureBloatedClaudeMd() {
  return [
    makeDoc({ name: "CLAUDE.md", body: "# Rules\n\n" + "Long rule block. ".repeat(5_000), size: 90_000 }),
    makeDoc({ name: "notes.md", body: "Clean notes.\n\n" + "content ".repeat(200), size: 2_000 }),
  ];
}

// 3. Duplicate-heavy vault — same block repeated across many files, with clean padding
function fixtureDuplicateVault() {
  const sharedBlock = "This is the exact same paragraph that appears in every file for no good reason. ".repeat(5);
  const docs = [];
  for (let i = 0; i < 8; i++) {
    docs.push(makeDoc({
      name: `memory-${i}.md`,
      path: `/fixture/memory-${i}.md`,
      body: `# File ${i}\n\n${sharedBlock}\n\nUnique content for file ${i}. ${"x".repeat(800 + i * 200)}`,
      size: 3_000,
    }));
  }
  // Additional clean padding to keep waste ratio below 1.0 (differentiate from single-giant)
  for (let i = 0; i < 5; i++) {
    docs.push(makeDoc({
      name: `ref-${i}.md`, path: `/fixture/ref-${i}.md`,
      body: `# Reference ${i}\n\nClean reference material. ${"q".repeat(1_000 + i * 100)}`,
      size: 1_500,
    }));
  }
  docs.push(makeDoc({ name: "CLAUDE.md", body: "Be helpful.\n\n" + "r".repeat(500), size: 600 }));
  return docs;
}

// 4. Single giant file — one file dominates the vault
function fixtureSingleGiant() {
  const docs = [
    makeDoc({ name: "CLAUDE.md", body: "Rules.\n\n" + "r".repeat(4_000), size: 5_000 }),
    makeDoc({ name: "giant.md", body: "# Giant\n\n" + "G".repeat(400_000), size: 410_000 }),
    makeDoc({ name: "small.md", body: "Small note.\n\n" + "s".repeat(500), size: 600 }),
  ];
  return docs;
}

// 5. Empty files + TODO markers
function fixtureEmptyTodo() {
  const docs = [];
  // 5 empty files
  for (let i = 0; i < 5; i++) {
    docs.push(makeDoc({ name: `empty-${i}.md`, path: `/fixture/empty-${i}.md`, body: "", size: 0 }));
  }
  // 6 files with TODO markers
  for (let i = 0; i < 6; i++) {
    docs.push(makeDoc({
      name: `task-${i}.md`,
      path: `/fixture/task-${i}.md`,
      body: `# Task ${i}\n\nTODO: finish this\nFIXME: broken\n\nContent ${"c".repeat(100)}`,
      size: 200,
    }));
  }
  docs.push(makeDoc({ name: "CLAUDE.md", body: "Be concise.\n\n" + "r".repeat(500), size: 600 }));
  return docs;
}

// 6. Mixed — a realistic messy vault
function fixtureMixed() {
  const sharedBlock = "Standard operating procedure for all projects: follow the style guide and run tests. ".repeat(3);
  return [
    makeDoc({ name: "CLAUDE.md", body: "# Rules\n\n" + "Rule content. ".repeat(2_000), size: 35_000 }),
    makeDoc({ name: "AGENTS.md", tool: "codex", body: "# Agents\n\n" + sharedBlock + "\n\nCodex-specific.", size: 1_500 }),
    makeDoc({ name: "big-ref.md", body: "# Reference\n\n" + "R".repeat(100_000), size: 102_000 }),
    makeDoc({ name: "notes.md", body: sharedBlock + "\n\nProject notes.", size: 1_000 }),
    makeDoc({ name: "empty.md", body: "", size: 0 }),
    makeDoc({ name: "wip.md", body: "TODO: review\nFIXME: broken\nTODO: test\nTODO: deploy\nTODO: docs", size: 200 }),
  ];
}

const FIXTURES = [
  { name: "clean-small", build: fixtureCleanSmall },
  { name: "bloated-claude", build: fixtureBloatedClaudeMd },
  { name: "duplicate-vault", build: fixtureDuplicateVault },
  { name: "single-giant", build: fixtureSingleGiant },
  { name: "empty-todo", build: fixtureEmptyTodo },
  { name: "mixed", build: fixtureMixed },
];

/* ── INV-1: Monotonicity ─────────────────────────────────────────────
   For every fixture × every finding: score(simulateFix) ≥ score.
   This is guaranteed by design (delta = max(0, fixed - score)),
   but we verify the underlying math never reverses. */
test("INV-1 monotonicity: fixing a finding never lowers the score", () => {
  for (const fixture of FIXTURES) {
    const docs = fixture.build();
    const result = analyze(docs, { os: "mac" });
    for (const finding of result.findings) {
      assert.ok(
        finding.delta >= 0,
        `${fixture.name}: finding "${finding.group}" has negative delta ${finding.delta}`
      );
      // Also verify: score + delta ≤ 100
      assert.ok(
        result.score + finding.delta <= 100,
        `${fixture.name}: score ${result.score} + delta ${finding.delta} exceeds 100`
      );
    }
  }
});

/* ── INV-2: Sensitivity ──────────────────────────────────────────────
   For each fixture, the top finding's delta must be ≥ 5 points.
   (Except clean-small which may have no significant findings.) */
test("INV-2 sensitivity: top finding delta ≥ 5 for non-trivial vaults", () => {
  const nonTrivial = FIXTURES.filter(f => f.name !== "clean-small");
  for (const fixture of nonTrivial) {
    const docs = fixture.build();
    const result = analyze(docs, { os: "mac" });
    const scoredFindings = result.findings.filter(f => f.group !== "stale");
    assert.ok(scoredFindings.length > 0, `${fixture.name}: expected at least one finding`);
    const maxDelta = Math.max(...scoredFindings.map(f => f.delta));
    assert.ok(
      maxDelta >= 5,
      `${fixture.name}: max delta is ${maxDelta}, expected ≥ 5`
    );
  }
});

/* ── INV-3: Denominator ──────────────────────────────────────────────
   Adding clean content to a vault must not lower the score. */
test("INV-3 denominator: adding clean content does not lower the score", () => {
  for (const fixture of FIXTURES) {
    const docs = fixture.build();
    const baseline = analyze(docs, { os: "mac" });

    // Add a bunch of clean files (no duplication, no AL, no TODO)
    const cleanDocs = [];
    for (let i = 0; i < 20; i++) {
      cleanDocs.push(makeDoc({
        name: `clean-addition-${i}.md`,
        path: `/fixture/clean-addition-${i}.md`,
        body: `# Clean file ${i}\n\nUnique content paragraph number ${i}. ${"u".repeat(500 + i * 7)}`,
        size: 1_000,
      }));
    }
    const expanded = analyze([...docs, ...cleanDocs], { os: "mac" });
    assert.ok(
      expanded.score >= baseline.score,
      `${fixture.name}: score dropped from ${baseline.score} to ${expanded.score} after adding clean content`
    );
  }
});

/* ── INV-4: Non-saturation ───────────────────────────────────────────
   No single score value may claim more than 10% of all fixtures. */
test("INV-4 non-saturation: no single score value dominates the distribution", () => {
  const scores = FIXTURES.map(f => analyze(f.build(), { os: "mac" }).score);
  const counts = new Map();
  for (const s of scores) {
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  for (const [value, count] of counts) {
    const pct = count / scores.length;
    assert.ok(
      pct <= 0.10 || count <= 1,
      `Score ${value} appears ${count}/${scores.length} times (${(pct * 100).toFixed(0)}%), exceeding 10% threshold. ` +
      `All scores: ${scores.join(", ")}`
    );
  }
});

/* ── Fixture bench: score range + grade curve ────────────────────────
   "First scan mostly C~B, fixing top finding yields visible gain."  */
test("fixture bench: scores spread across grades, top fix is visible", () => {
  const results = [];
  for (const fixture of FIXTURES) {
    const docs = fixture.build();
    const result = analyze(docs, { os: "mac" });
    results.push({ name: fixture.name, ...result });
  }

  // At least 2 different grades across fixtures
  const grades = new Set(results.map(r => r.grade));
  assert.ok(grades.size >= 2, `Only ${grades.size} grade(s) across ${FIXTURES.length} fixtures: ${[...grades].join(", ")}`);

  // For every non-clean fixture, the top finding delta > 0
  for (const r of results) {
    if (r.findings.length === 0) continue;
    const topDelta = r.findings[0]?.delta ?? 0;
    if (r.grade !== "S" && r.grade !== "A") {
      assert.ok(topDelta > 0, `${r.name} (grade ${r.grade}): top finding has delta 0, no actionable improvement`);
    }
  }

  // Log for human review
  for (const r of results) {
    const top = r.findings[0];
    const topDesc = top ? `top: ${top.group} +${top.delta} (${top.severity})` : "no findings";
    // console.log(`  ${r.name}: ${r.score} ${r.grade} [F:${r.subscores.fixed} W:${r.subscores.waste} H:${r.subscores.hygiene}] ${topDesc}`);
  }
});

/* ── v2 output shape ─────────────────────────────────────────────────
   Verify the new fields are present and well-typed. */
test("v2 output has subscores, delta, and severity on findings", () => {
  const result = analyze(fixtureMixed(), { os: "mac" });
  assert.equal(result.v, 2);
  assert.ok("subscores" in result);
  assert.equal(typeof result.subscores.fixed, "number");
  assert.equal(typeof result.subscores.waste, "number");
  assert.equal(typeof result.subscores.hygiene, "number");
  for (const f of result.findings) {
    assert.equal(typeof f.delta, "number");
    assert.ok(["HIGH", "MED", "LOW", "INFO"].includes(f.severity), `bad severity: ${f.severity}`);
  }
  // findings sorted by delta descending (stale last)
  const nonStale = result.findings.filter(f => f.group !== "stale");
  for (let i = 1; i < nonStale.length; i++) {
    assert.ok(nonStale[i - 1].delta >= nonStale[i].delta,
      `Findings not sorted by delta: ${nonStale[i - 1].delta} < ${nonStale[i].delta}`);
  }
});

/* ── Score range 0~100, no floor clamp ───────────────────────────────
   A vault that is 100% waste should score near 0, not 20. */
test("v2 score can go below 20 (no floor clamp)", () => {
  // Massive CLAUDE.md (maxes fixed cost) + giant file (maxes waste)
  const docs = [
    makeDoc({ name: "CLAUDE.md", body: "x".repeat(260_000), size: 260_000 }),
    makeDoc({ name: "giant.md", body: "y".repeat(260_000), size: 260_000 }),
  ];
  const result = analyze(docs, { os: "mac" });
  assert.ok(result.score < 20, `Expected score < 20, got ${result.score}`);
});

/* ── Grade boundaries unchanged ──────────────────────────────────── */
test("grade thresholds: S≥90, A≥78, B≥65, C≥50, F<50", () => {
  assert.equal(gradeForScore(100), "S");
  assert.equal(gradeForScore(90), "S");
  assert.equal(gradeForScore(89), "A");
  assert.equal(gradeForScore(78), "A");
  assert.equal(gradeForScore(77), "B");
  assert.equal(gradeForScore(65), "B");
  assert.equal(gradeForScore(64), "C");
  assert.equal(gradeForScore(50), "C");
  assert.equal(gradeForScore(49), "F");
  assert.equal(gradeForScore(0), "F");
});
