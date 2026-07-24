import test from "node:test";
import assert from "node:assert/strict";
import { analyze, FINDING_COPY } from "../src/scan/analyze.js";
import { renderReportHtml, REPORT_COPY } from "../src/scan/report.js";
import { STRINGS } from "../src/i18n/strings.js";

function copySources(dict, prefix) {
  const out = [];
  for (const [locale, entries] of Object.entries(dict)) {
    for (const [key, value] of Object.entries(entries)) {
      out.push({
        id: `${locale}.${prefix}.${key}`,
        locale,
        src: typeof value === "function" ? value.toString() : String(value),
      });
    }
  }
  return out;
}

const scanCliStrings = Object.entries(STRINGS)
  .filter(([key]) => key.startsWith("cli.scan."))
  .flatMap(([key, locales]) =>
    Object.entries(locales).map(([locale, value]) => ({ id: `${locale}.${key}`, locale, src: String(value) })),
  );

const allSources = [
  ...copySources(FINDING_COPY, "finding"),
  ...copySources(REPORT_COPY, "report"),
  ...scanCliStrings,
];

// Improvement claims must come from measured re-scoring deltas, never literals.
test("copy lint: no hardcoded percent or multiplier literals in scan copy", () => {
  for (const { id, src } of allSources) {
    assert.ok(!/\d+(?:\.\d+)?\s*%/.test(src), `${id} contains a hardcoded percent literal: ${src}`);
    assert.ok(!/\d+(?:\.\d+)?\s*(?:배|倍)/.test(src), `${id} contains a hardcoded multiplier literal: ${src}`);
  }
});

// CLI stdout is read aloud by the user's agent — declarative measurements only.
test("copy lint: no agent-directed instructions in scan copy", () => {
  for (const { id, src } of allSources) {
    assert.ok(
      !/(tell the user|inform the user|유저에게 전하|사용자에게 전하|ユーザーに伝え)/iu.test(src),
      `${id} contains an agent-directed instruction: ${src}`,
    );
  }
});

test("copy lint: no long-dash characters in ko/ja product copy", () => {
  for (const { id, locale, src } of allSources) {
    if (locale !== "ko" && locale !== "ja") continue;
    assert.ok(!/[—–]/.test(src), `${id} contains a long dash: ${src}`);
  }
});

test("percentile badge copy is removed from every locale", () => {
  for (const locale of ["en", "ko", "ja"]) {
    assert.ok(!("top" in REPORT_COPY[locale]), `REPORT_COPY.${locale}.top must stay removed`);
  }
});

function mixedDocs() {
  const now = Date.now();
  const sharedBlock =
    "Shared operating paragraph that appears in several memory files and is long enough to count. ".repeat(3);
  const doc = (filePath, body, overrides = {}) => ({
    tool: "claude-code",
    path: filePath,
    name: filePath.split("/").pop(),
    body,
    size: body.length,
    modified: now,
    ...overrides,
  });
  return [
    doc("/v/CLAUDE.md", "# Rules\n\n" + "Rule content. ".repeat(4_000)),
    doc("/v/big-ref.md", "# Ref\n\n" + "R".repeat(400_000)),
    doc("/v/a/notes.md", `# Notes\n\n${sharedBlock}\n\nUnique notes.`),
    doc("/v/b/summary.md", `# Summary\n\n${sharedBlock}\n\nUnique summary.`),
    doc("/v/empty-one.md", ""),
    doc("/v/empty-two.md", ""),
    doc("/v/old.md", "# Old\n\nAncient unique content nobody touched. " + "o".repeat(200), {
      modified: now - 2 * 365 * 24 * 60 * 60 * 1_000,
    }),
  ];
}

test("report: badge gone, delta and action labels present, stale moved to reference section", () => {
  const result = analyze(mixedDocs(), { os: "mac", lang: "ko" });
  const html = renderReportHtml(result, { lang: "ko", pingStatus: "disabled" });

  assert.ok(!/Top \d+%|상위 \d+%|上位 \d+%/u.test(html), "percentile badge must not render");
  assert.ok(html.includes("구조적 재발"), "structural action label expected");
  assert.ok(html.includes("판단 필요"), "judgment action label expected");
  assert.ok(html.includes("지금 고쳐도 안전"), "safe action label expected");
  assert.ok(html.includes("정리하면 +"), "measured delta line expected");
  assert.ok(html.includes("<h2>참고</h2>"), "stale findings belong in the reference section");

  assert.ok(Number.isInteger(result.potential) && result.potential >= result.score);
  if (result.potential > result.score) {
    assert.ok(
      html.includes(`지금 ${result.score} → 정리하면 ${result.potential}`),
      "computed counterfactual subline expected",
    );
  }

  const staleIndex = html.indexOf("<h2>참고</h2>");
  const findingsIndex = html.indexOf("finding-stale");
  assert.ok(findingsIndex > staleIndex, "stale card must render after the reference heading");
});

test("report: potential subline hidden when nothing is fixable", () => {
  const clean = [
    {
      tool: "claude-code",
      path: "/v/notes.md",
      name: "notes.md",
      body: "# Notes\n\nJust one tidy unique note. " + "n".repeat(200),
      size: 300,
      modified: Date.now(),
    },
  ];
  const result = analyze(clean, { os: "mac", lang: "en" });
  const html = renderReportHtml(result, { lang: "en", pingStatus: "disabled" });
  assert.equal(result.potential, result.score);
  assert.ok(!html.includes("after cleanup"), "no counterfactual line when potential equals score");
});
