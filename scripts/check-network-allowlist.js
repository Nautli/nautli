// TASK-106
import fs from "node:fs";
// TASK-106
import path from "node:path";
// TASK-106
import { fileURLToPath } from "node:url";

// TASK-106
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// TASK-106
const DEFAULT_SOURCE_ROOT = path.join(REPOSITORY_ROOT, "src");
// TASK-106
const NETWORK_USAGE = /\b(?:globalThis\.)?fetch\s*\(|\b(?:http|https|net|tls)\s*\.\s*(?:get|request|createServer|connect|createConnection)\s*\(|\b(?:require|import)\s*\(\s*["'](?:node:)?(?:http|https|net|tls)["']\s*\)|\bfrom\s*["'](?:node:)?(?:http|https|net|tls)["']|\bimport\s*["'](?:node:)?(?:http|https|net|tls)["']/gu;

// TASK-106
function sourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(file));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(file);
  }
  return files.sort();
}

// TASK-106
function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

// TASK-106
function location(file, text, index) {
  return `${path.relative(REPOSITORY_ROOT, file)}:${lineNumber(text, index)}`;
}

// TASK-106
function approvedDashboardPublic(text, index) {
  const line = text.slice(index, text.indexOf("\n", index) === -1 ? text.length : text.indexOf("\n", index));
  return /\bfetch\s*\(\s*["']\//u.test(line)
    || /\bfetch\s*\(\s*url\s*,/u.test(line)
    && /function api\(url,options\).*\bfetch\s*\(url,options\)/u.test(text)
    && !/\bapi\s*\(\s*["'][^"']*(?:https?:|\/\/)/u.test(text)
    && !/\bpost\s*\(\s*["'][^"']*(?:https?:|\/\/)/u.test(text);
}

// TASK-106
function approvedDashboardServer(text, usage) {
  return usage.startsWith('from "node:http"')
    || usage.startsWith("from 'node:http'")
    || /\bhttp\s*\.\s*createServer\s*\(/u.test(usage)
      && /server\.listen\(port, "127\.0\.0\.1"/u.test(text);
}

// TASK-106
function approvedUsage(file, text, match) {
  const relative = path.relative(REPOSITORY_ROOT, file);
  const usage = match[0];
  if (relative === "src/daemon/telemetry.js") {
    return usage.includes("fetch")
      && text.includes('const DEFAULT_ENDPOINT = "https://telemetry.nautli.ai/v1/daily"')
      && /\bfetch\s*\(endpoint\s*,/u.test(text);
  }
  if (relative === "src/scan/ping.js") {
    return usage.includes("fetch") && /\bfetch\s*\("https:\/\/nautli\.ai\/api\/ping"/u.test(text);
  }
  if (relative === "src/scan/report.js") {
    return usage.includes("fetch") && /\bfetch\s*\("https:\/\/nautli\.ai\/api\/share"/u.test(text);
  }
  if (relative === "src/dashboard/public.js") return approvedDashboardPublic(text, match.index);
  if (relative === "src/dashboard/server.js") return approvedDashboardServer(text, usage);
  return false;
}

// TASK-106
function checkSource(sourceRoot) {
  const failures = [];
  for (const file of sourceFiles(sourceRoot)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(NETWORK_USAGE)) {
      if (!approvedUsage(file, text, match)) failures.push(location(file, text, match.index));
    }
  }
  return failures;
}

// TASK-106
function main() {
  const sourceRoot = path.resolve(process.argv[2] ?? DEFAULT_SOURCE_ROOT);
  let failures;
  try {
    failures = checkSource(sourceRoot);
  } catch (error) {
    process.stderr.write(`cannot check network allowlist: ${error.message}\n`);
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
