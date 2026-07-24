// TASK-106
import fs from "node:fs";
// TASK-106
import path from "node:path";
// TASK-106
import { spawnSync } from "node:child_process";
// TASK-106
import { fileURLToPath } from "node:url";

// TASK-106
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// TASK-106
const DEFAULT_LEDGER = path.join(REPOSITORY_ROOT, "docs", "TRUST-CLAIMS.md");

// TASK-106
function markdownLinks(text) {
  return [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map((match) => match[1]);
}

// TASK-106
function localLink(target) {
  return target !== "" && !target.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/iu.test(target) && !target.startsWith("//");
}

// TASK-113
function backtickArtifacts(text) {
  return [...text.matchAll(/`([^`\r\n]+)`/gu)]
    .map((match) => match[1])
    .filter((token) => !token.startsWith("~")
      && !path.isAbsolute(token)
      && !/:\d+$/u.test(token)
      && /(?:^|\/)[^/]+\.(?:cjs|js|json|md|mjs|py|sh|txt|ya?ml)$/iu.test(token));
}

// TASK-113
function artifactExists(ledger, artifact) {
  return [path.resolve(path.dirname(ledger), artifact), path.resolve(REPOSITORY_ROOT, artifact)]
    .some((candidate) => fs.existsSync(candidate));
}

// TASK-113
function commitTokens(text) {
  const contexts = [
    ...[...text.matchAll(/\[[^\]]*\]\([^)]*\)/gu)].map((match) => match[0]),
    ...text.split(/\r?\n/gu).filter((line) => /^\s*\|/u.test(line)),
  ];
  return contexts.flatMap((context) => [...context.matchAll(/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/giu)]
    .map((match) => match[0]));
}

// TASK-106
function commitExists(hash) {
  const result = spawnSync("git", ["cat-file", "-e", `${hash}^{commit}`], {
    cwd: REPOSITORY_ROOT,
    stdio: "ignore",
  });
  return result.status === 0;
}

// TASK-106
function checkLedger(ledger) {
  const failures = [];
  const text = fs.readFileSync(ledger, "utf8");
  for (const target of markdownLinks(text)) {
    const targetPath = decodeURIComponent(target.split("#", 1)[0]);
    if (localLink(target) && !fs.existsSync(path.resolve(path.dirname(ledger), targetPath))) {
      failures.push(`broken link: ${target}`);
    }
  }
  // TASK-113
  for (const artifact of new Set(backtickArtifacts(text))) {
    if (!artifactExists(ledger, artifact)) failures.push(`broken artifact: ${artifact}`);
  }
  // TASK-113
  for (const hash of new Set(commitTokens(text))) {
    if (!commitExists(hash)) failures.push(`broken commit: ${hash}`);
  }
  return failures;
}

// TASK-106
function main() {
  const ledger = path.resolve(process.argv[2] ?? DEFAULT_LEDGER);
  let failures;
  try {
    failures = checkLedger(ledger);
  } catch (error) {
    process.stderr.write(`cannot check trust claims: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
}

// TASK-106
main();
