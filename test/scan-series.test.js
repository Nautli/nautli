import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/scan/analyze.js";

const sharedBlock =
  "Complaint boilerplate paragraph shared by every filing in this series for legal reasons. ".repeat(4);

function makeDoc(filePath, body, overrides = {}) {
  return {
    tool: "claude-code",
    path: filePath,
    name: filePath.split("/").pop(),
    body,
    size: body.length,
    modified: Date.now(),
    ...overrides,
  };
}

function padding() {
  const docs = [makeDoc("/vault/CLAUDE.md", "Be concise.\n\n" + "r".repeat(400))];
  for (let i = 0; i < 4; i += 1) {
    docs.push(makeDoc(`/vault/ref/topic-${i}.md`, `# Topic ${i}\n\nUnique reference ${i}. ${"u".repeat(900 + i * 50)}`));
  }
  return docs;
}

// Same directory + version/suffix series sharing one paragraph = intentional per-item docs.
function seriesDocs() {
  return [
    makeDoc("/vault/legal/complaint-v1.md", `# v1\n\n${sharedBlock}\n\nCase one details.`),
    makeDoc("/vault/legal/complaint-v2.md", `# v2\n\n${sharedBlock}\n\nCase two details.`),
    makeDoc("/vault/legal/complaint-v3-발송용.md", `# v3\n\n${sharedBlock}\n\nCase three details.`),
    ...padding(),
  ];
}

// Different directories, no series naming = genuine stray copies.
function copyDocs() {
  return [
    makeDoc("/vault/a/notes.md", `# Notes\n\n${sharedBlock}\n\nMore notes.`),
    makeDoc("/vault/b/summary.md", `# Summary\n\n${sharedBlock}\n\nMore summary.`),
    makeDoc("/vault/c/digest.md", `# Digest\n\n${sharedBlock}\n\nMore digest.`),
    ...padding(),
  ];
}

test("series blocks are suppressed: excluded from waste scoring, finding kept (non-lossy)", () => {
  const result = analyze(seriesDocs(), { os: "mac" });
  const finding = result.findings.find((f) => f.group === "repeated");
  assert.ok(finding, "repeated finding must stay visible even when suppressed");
  assert.equal(finding.seriesSuspect, true);
  assert.equal(finding.delta, 0, "suppressed series must not promise score gains");
  assert.equal(result.subscores.waste, 100, "suppressed series must not count as waste");
});

test("genuine copies are not suppressed and still count as waste", () => {
  const result = analyze(copyDocs(), { os: "mac" });
  const finding = result.findings.find((f) => f.group === "repeated");
  assert.ok(finding, "repeated finding expected for genuine copies");
  assert.equal(finding.seriesSuspect, false);
  assert.ok(result.subscores.waste < 100, `waste should drop for genuine copies, got ${result.subscores.waste}`);
});

test("mixed set below 60% series ratio is not suppressed", () => {
  const docs = [
    makeDoc("/vault/legal/complaint-v1.md", `# v1\n\n${sharedBlock}\n\nOne.`),
    makeDoc("/vault/legal/random-note.md", `# Note\n\n${sharedBlock}\n\nTwo.`),
    makeDoc("/vault/other/another-note.md", `# Other\n\n${sharedBlock}\n\nThree.`),
    ...padding(),
  ];
  const result = analyze(docs, { os: "mac" });
  const finding = result.findings.find((f) => f.group === "repeated");
  assert.ok(finding);
  assert.equal(finding.seriesSuspect, false);
});
