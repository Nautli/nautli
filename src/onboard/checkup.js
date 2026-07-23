import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ERR, validScope } from "../core/schema.js";
import { Store } from "../core/store.js";
import { remember } from "../core/gate.js";
import { appendCards } from "../core/review.js";
import { makeT, resolveLocale } from "../i18n/strings.js";
import { checkClaudeLogin, checkCommand } from "./doctor.js";

const DOCTOR_SCRIPT = fileURLToPath(new URL("../../vendor/vault-doctor/vault_doctor.py", import.meta.url));
// 맛보기 진단 기본 캡 — 온보딩은 "몇 분" 안에 끝나야 한다 (풀 진단은 CLI 몫)
export const TASTE = Object.freeze({ maxFiles: 40, junkSample: 12, maxJudgePairs: 150 });
export const DEFAULT_SWEEP_KINDS = new Set(["claude-harness", "codex-harness", "gemini-harness"]);
const IMPORT_CAP = 800;
// 크로스AI 하네스 홈 — 숨김폴더라 walk가 못 찾으니 특례
const HARNESS_HOMES = [
  { dir: ".claude", kind: "claude-harness", labelKey: "checkup.harness_claude", marker: "CLAUDE.md" },
  { dir: ".codex", kind: "codex-harness", labelKey: "checkup.harness_codex", marker: "AGENTS.md" },
  { dir: ".gemini", kind: "gemini-harness", labelKey: "checkup.harness_gemini", marker: "GEMINI.md" },
  { dir: ".cursor", kind: "cursor-harness", labelKey: "checkup.harness_cursor", marker: null },
  { dir: ".shared-memory", kind: "shared-memory", labelKey: "checkup.harness_shared", marker: null },
];

function translator(locale) {
  return makeT(locale ?? resolveLocale());
}

function codedError(code, message) {
  const error = new Error(message ?? code);
  error.code = code;
  return error;
}

function countNotes(dir, cap = 4000, excludedDirs = []) {
  let count = 0;
  const excluded = new Set(excludedDirs);
  const queue = [{ directory: dir, top: null }];
  while (queue.length > 0 && count < cap) {
    const { directory: current, top } = queue.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const childTop = top ?? entry.name;
      if (top === null && excluded.has(entry.name)) continue;
      if (entry.isDirectory()) queue.push({ directory: path.join(current, entry.name), top: childTop });
      else if (entry.name.endsWith(".md")) count += 1;
    }
  }
  return count;
}

function topLevelDirs(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => ({ name: entry.name, files: countNotes(path.join(dir, entry.name)) }))
    .filter((entry) => entry.files > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeExcludedDirs(value, available, locale) {
  const t = translator(locale);
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw codedError(ERR.E_INVALID_INPUT, t("checkup.invalid_excludes"));
  }
  const allowed = new Set(available.map((entry) => entry.name));
  const selected = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))].sort();
  if (selected.some((entry) => !allowed.has(entry))) {
    throw codedError(ERR.E_INVALID_INPUT, t("checkup.top_level_only"));
  }
  return selected;
}

export function vaultSampleSeed(vaultPath) {
  return createHash("sha256").update(path.resolve(vaultPath)).digest("hex");
}

// 유저 홈에서 진단 후보를 찾는다: 옵시디언 볼트(.obsidian 폴더) + 크로스AI 하네스 홈
export function checkupCandidates({
  userHome = os.homedir(),
  roots,
  maxDepth = 3,
  locale,
} = {}) {
  const t = translator(locale);
  const searchRoots = roots ?? [
    path.join(userHome, "Documents"),
    path.join(userHome, "Desktop"),
    userHome,
  ];
  const found = new Map();
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isDirectory() && entry.name === ".obsidian")) {
      found.set(dir, { path: dir, kind: "obsidian", label: path.basename(dir) });
      return; // 볼트 안에서 볼트를 또 찾지 않는다
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || ["node_modules", "Library", "Applications", "Movies", "Music", "Pictures"].includes(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  for (const root of searchRoots) walk(root, 1);
  // 마커 없는 하네스는 번들 문서(README/SKILL.md)가 노트로 오인되는 노이즈를 만든다.
  for (const { dir, kind, labelKey, marker } of HARNESS_HOMES) {
    const harnessHome = path.join(userHome, dir);
    if (fs.existsSync(harnessHome) && fs.statSync(harnessHome).isDirectory()
      && (!marker || fs.existsSync(path.join(harnessHome, marker)))) {
      found.set(harnessHome, { path: harnessHome, kind, label: t(labelKey) });
    }
  }
  return [...found.values()].map((candidate) => {
    const notes = countNotes(candidate.path);
    const directories = topLevelDirs(candidate.path);
    return {
      ...candidate,
      default_sweep: DEFAULT_SWEEP_KINDS.has(candidate.kind),
      notes,
      files: notes,
      top_level_dirs: directories,
      directories,
    };
  })
    .filter((candidate) => candidate.notes > 0)
    .sort((a, b) => Number(b.default_sweep) - Number(a.default_sweep) || b.notes - a.notes)
    .slice(0, 8);
}

function checkupHome(home) {
  return path.join(home, "checkup");
}

function currentFile(home) {
  return path.join(checkupHome(home), "current.json");
}

// TASK-002
function startLockPath(home) {
  return path.join(checkupHome(home), ".start-lock");
}

// TASK-002
function readStartLockOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

// TASK-002
function deadStartLockOwner(owner) {
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

// TASK-002
function acquireStartLock(home, t) {
  const directory = checkupHome(home);
  const lockPath = startLockPath(home);
  fs.mkdirSync(directory, { recursive: true });
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      try {
        fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({
          pid: process.pid,
          started_at: new Date().toISOString(),
        }));
        return lockPath;
      } catch (error) {
        // TASK-002
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (!deadStartLockOwner(readStartLockOwner(lockPath))) {
        throw codedError(ERR.E_STORE_BUSY, t("checkup.already_running"));
      }
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  }
}

export function readCurrent(home) {
  const file = currentFile(home);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCurrent(home, value) {
  fs.mkdirSync(checkupHome(home), { recursive: true });
  const file = currentFile(home);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 1));
  fs.renameSync(temp, file);
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function validateVaultPath(vaultPath, {
  userHome = os.homedir(),
  home,
  locale,
} = {}) {
  const t = translator(locale);
  if (typeof vaultPath !== "string" || vaultPath.trim() === "") throw codedError(ERR.E_INVALID_INPUT, t("checkup.path_required"));
  let resolved;
  let resolvedUserHome;
  let resolvedHome;
  try {
    resolved = fs.realpathSync(path.resolve(vaultPath.replace(/^~(?=\/|$)/, userHome)));
  } catch {
    throw codedError(ERR.E_NOT_FOUND, t("checkup.folder_not_found"));
  }
  // userHome/NAUTLI_HOME이 아직 없을 수 있다(생짜 신규 유저) — 경계 기준은 존재하면 canonical, 없으면 resolve로
  const canonical = (p) => { try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); } };
  resolvedUserHome = canonical(userHome);
  resolvedHome = home ? canonical(home) : null;
  if (!fs.statSync(resolved).isDirectory()) throw codedError(ERR.E_NOT_FOUND, t("checkup.folder_not_found"));
  const userRelative = path.relative(resolvedUserHome, resolved);
  if (userRelative.startsWith(`..${path.sep}`) || userRelative === ".." || path.isAbsolute(userRelative)) throw codedError(ERR.E_INVALID_INPUT, t("checkup.home_only"));
  if (resolvedHome) {
    const homeRelative = path.relative(resolvedHome, resolved);
    if (homeRelative === "" || (!homeRelative.startsWith(`..${path.sep}`) && homeRelative !== ".." && !path.isAbsolute(homeRelative))) throw codedError(ERR.E_INVALID_INPUT, t("checkup.store_forbidden"));
  }
  return resolved;
}

function normalizeVaultPaths(vaultPathOrPaths, options) {
  const inputs = Array.isArray(vaultPathOrPaths) ? vaultPathOrPaths : [vaultPathOrPaths];
  if (inputs.length === 0) return [validateVaultPath(undefined, options)];
  const unique = [...new Set(inputs.map((vaultPath) => validateVaultPath(vaultPath, options)))];
  return unique
    .filter((candidate) => !unique.some((parent) => {
      if (parent === candidate) return false;
      const relative = path.relative(parent, candidate);
      return relative !== "" && !relative.startsWith(`..${path.sep}`)
        && relative !== ".." && !path.isAbsolute(relative);
    }))
    .sort((a, b) => a.localeCompare(b));
}

function combinedTopLevelDirs(vaults) {
  const combined = new Map();
  for (const vault of vaults) {
    for (const directory of topLevelDirs(vault)) {
      combined.set(directory.name, (combined.get(directory.name) ?? 0) + directory.files);
    }
  }
  return [...combined.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function vaultSetSampleSeed(vaults) {
  if (vaults.length === 1) return vaultSampleSeed(vaults[0]);
  return createHash("sha256").update(vaults.join("\0")).digest("hex");
}

function doctorRunSlug(vaults, excluded, sampleSeed) {
  const slugConfig = vaults.map((root) => ({
    exclude: [...excluded].sort(),
    max_files: TASTE.maxFiles,
    root,
    sample_seed: sampleSeed,
  }));
  const hash = createHash("sha1").update(JSON.stringify(slugConfig)).digest("hex").slice(0, 10);
  const name = vaults.length === 1 ? path.basename(vaults[0]) : `multisource-${vaults.length}`;
  return `${name}-${hash}`;
}

export function checkupPreflight(home, vaultPathOrPaths, options = {}) {
  const {
    userHome = os.homedir(),
    runner = spawnSync,
    excludedDirs = options.excluded_dirs,
    locale,
  } = options;
  const resolved = normalizeVaultPaths(vaultPathOrPaths, { userHome, home, locale });
  const topLevel = combinedTopLevelDirs(resolved);
  const excluded = normalizeExcludedDirs(excludedDirs, topLevel, locale);
  const sourceFiles = resolved.map((vault) => countNotes(vault, 4000, excluded));
  const files = sourceFiles.reduce((total, count) => total + count, 0);
  const sampledFiles = sourceFiles.reduce(
    (total, count) => total + Math.min(count, TASTE.maxFiles),
    0,
  );
  const python = checkCommand("python3", ["--version"], runner);
  const claude = checkClaudeLogin(runner);
  return {
    ok: python && claude.cli_exists && claude.logged_in && files > 0,
    vault: resolved[0],
    vaults: resolved,
    python3: { available: python },
    claude,
    files,
    sampled_files: sampledFiles,
    // 실측 보정(2026-07-21): 40파일 맛보기 ≈ 5분(throughput ~8파일/분). 옛 상수(3.75파일/분)는 ~2배 과대였다.
    // 소폭 버퍼를 둬 ~7파일/분으로 추정하고 최소 2분 바닥을 둔다.
    estimated_minutes: Math.max(2, Math.ceil(sampledFiles / 7)),
    top_level_dirs: topLevel,
    directories: topLevel,
    excluded_dirs: excluded,
    sample_seed: vaultSetSampleSeed(resolved),
  };
}

export function startCheckup(home, vaultPathOrPaths, options = {}) {
  const {
    userHome = os.homedir(),
    spawner = spawn,
    excludedDirs = options.excluded_dirs,
    locale,
  } = options;
  const t = translator(locale);
  const resolved = normalizeVaultPaths(vaultPathOrPaths, { userHome, home, locale });
  const excluded = normalizeExcludedDirs(excludedDirs, combinedTopLevelDirs(resolved), locale);
  if (resolved.every((vault) => countNotes(vault, 1, excluded) === 0)) {
    throw codedError(ERR.E_INVALID_INPUT, t("checkup.no_markdown"));
  }
  // TASK-002
  const lockPath = acquireStartLock(home, t);
  let log;
  try {
    const existing = readCurrent(home);
    if (existing && existing.state === "running" && pidAlive(existing.pid)) {
      throw codedError(ERR.E_STORE_BUSY, t("checkup.already_running"));
    }
    const python = spawnSync("python3", ["--version"], { stdio: "ignore" });
    if (python.error || python.status !== 0) throw codedError(ERR.E_INVALID_INPUT, t("checkup.python_required"));
    const workHome = path.join(checkupHome(home), "doctor");
    fs.mkdirSync(workHome, { recursive: true });
    const sampleSeed = vaultSetSampleSeed(resolved);
    const slug = doctorRunSlug(resolved, excluded, sampleSeed);
    const runDir = path.resolve(workHome, "runs", slug);
    const logPath = path.join(checkupHome(home), "checkup.log");
    log = fs.openSync(logPath, "a");
    const args = [
      DOCTOR_SCRIPT, ...resolved,
      "--work-home", workHome,
      "--max-files", String(TASTE.maxFiles),
      "--sample-seed", sampleSeed,
      "--junk-sample", String(TASTE.junkSample),
      "--max-judge-pairs", String(TASTE.maxJudgePairs),
    ];
    for (const directory of excluded) args.push("--exclude", directory);
    if (fs.existsSync(runDir)) {
      args.push("--fresh");
      fs.rmSync(runDir, { recursive: true, force: true });
    }
    const child = spawner("python3", args, { detached: true, stdio: ["ignore", log, log] });
    const started = {
      state: "running", vault: resolved[0], vaults: resolved, work_home: workHome, run_dir: runDir,
      started_at: new Date().toISOString(), pid: child.pid ?? null, mode: "taste",
      excluded_dirs: excluded, sample_seed: sampleSeed,
    };
    // TASK-002
    child.on?.("error", (error) => {
      writeCurrent(home, {
        ...started,
        state: "failed",
        error: t("checkup.python_start_failed", {
          reason: error.message || t("checkup.check_runtime"),
        }),
      });
    });
    child.unref?.();
    fs.closeSync(log);
    log = undefined;
    writeCurrent(home, started);
    return {
      ok: true,
      started: true,
      vault: resolved[0],
      vaults: resolved,
      pid: child.pid ?? null,
      excluded_dirs: excluded,
    };
  } finally {
    // TASK-002
    if (log !== undefined) fs.closeSync(log);
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function summaryIsFresh(current, runDir) {
  if (!runDir) return false;
  const file = path.join(runDir, "summary.json");
  if (!fs.existsSync(file)) return false;
  const startedAt = Date.parse(current.started_at);
  if (!Number.isFinite(startedAt)) return true;
  try {
    return fs.statSync(file).mtimeMs >= startedAt - 2000;
  } catch {
    return false;
  }
}

function readLogTail(home, maxBytes = 4096) {
  const file = path.join(checkupHome(home), "checkup.log");
  let descriptor;
  try {
    descriptor = fs.openSync(file, "r");
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function lastJudgeTotal(home) {
  const matches = [...readLogTail(home).matchAll(/judge j\d+\/(\d+)/gu)];
  if (matches.length === 0) return null;
  const total = Number(matches.at(-1)[1]);
  return Number.isSafeInteger(total) ? total : null;
}

// 리포트 카드용 대표 사례: 모순(확신 높은 순) 우선, 다음 중간확신 중복 — vault_doctor build_cards와 같은 규칙
function topCards(runDir, limit = 2) {
  const judgments = readJsonl(path.join(runDir, "judgments.jsonl"));
  const pairs = readJsonl(path.join(runDir, "pairs.jsonl"));
  const byId = new Map(pairs.map((pair) => [`${pair.a}|${pair.b}`, pair]));
  const pick = (verdict, min, max) => judgments
    .filter((j) => j.verdict === verdict && (j.confidence ?? 0) >= min && (j.confidence ?? 0) < max)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const cards = [];
  for (const judgment of [...pick("contradiction", 0.6, 1.01), ...pick("duplicate", 0.6, 0.9)]) {
    const pair = byId.get(judgment.pair_id);
    if (!pair) continue;
    cards.push({
      kind: judgment.verdict, confidence: judgment.confidence ?? null, newer: judgment.newer ?? null,
      a: { claim: pair.claim_a, src: pair.src_a ?? null }, b: { claim: pair.claim_b, src: pair.src_b ?? null },
    });
    if (cards.length >= limit) break;
  }
  return cards;
}

function partialFindings(runDir) {
  if (!runDir) return { contradictions: 0, duplicates: 0, teaser: null };
  const collected = [];
  const done = path.join(runDir, "done_judge");
  if (fs.existsSync(done)) {
    for (const file of fs.readdirSync(done).filter((name) => name.endsWith(".jsonl")).sort()) {
      collected.push(...readJsonl(path.join(done, file)));
    }
  }
  collected.push(...readJsonl(path.join(runDir, "judgments.jsonl")));
  const judgments = [...new Map(collected
    .filter((judgment) => typeof judgment?.pair_id === "string")
    .map((judgment) => [judgment.pair_id, judgment])).values()];
  const contradictions = judgments.filter((judgment) => judgment.verdict === "contradiction"
    && Number(judgment.confidence ?? 0) >= 0.6);
  const duplicates = judgments.filter((judgment) => judgment.verdict === "duplicate");
  const first = judgments.find((judgment) => judgment.verdict === "duplicate"
    || (judgment.verdict === "contradiction" && Number(judgment.confidence ?? 0) >= 0.6));
  if (!first) return { contradictions: 0, duplicates: 0, teaser: null };
  const pair = readJsonl(path.join(runDir, "pairs.jsonl"))
    .find((candidate) => `${candidate.a}|${candidate.b}` === first.pair_id);
  return {
    contradictions: contradictions.length,
    duplicates: duplicates.length,
    teaser: pair ? {
      kind: first.verdict,
      a: { claim: pair.claim_a, src: pair.src_a ?? null },
      b: { claim: pair.claim_b, src: pair.src_b ?? null },
    } : null,
  };
}

export function checkupStatus(home) {
  const current = readCurrent(home);
  if (!current) return { state: "none" };
  if (current.state === "dismissed") return { state: "dismissed" };
  const failedStatus = () => {
    const logTail = readLogTail(home).split("\n").filter((line) => line.trim()).slice(-3).join("\n");
    return { state: "failed", vault: current.vault, log_tail: current.error || logTail };
  };
  const runDir = current.run_dir;
  const startedAt = Date.parse(current.started_at);
  const timedOut = current.state === "running" && Number.isFinite(startedAt) && Date.now() - startedAt >= 90 * 60 * 1000;
  // 결과가 이미 있으면(summary/imported) 90분 타임아웃으로 뒤집지 않는다 — 완료 후 시간이 지나면 failed로 위장되던 회귀
  const hasSummary = summaryIsFresh(current, runDir);
  const hasResult = Boolean(current.imported_at) || hasSummary;
  if (current.state === "failed" || (timedOut && !hasResult)) return failedStatus();
  const manifest = runDir ? readJson(path.join(runDir, "manifest.json")) : null;
  const filesSampled = typeof manifest?.files === "number" ? manifest.files : null;
  const summary = hasSummary ? readJson(path.join(runDir, "summary.json")) : null;
  if (summary) {
    const failedBatches = summary.failed_extract_batches ?? 0;
    const partial = failedBatches > 0 || ((summary.notes ?? 0) > 0 && (summary.atoms ?? 0) === 0);
    return {
      state: current.imported_at ? "imported" : "done",
      vault: current.vault, summary, cards: topCards(runDir),
      imported: current.imported ?? null, report_file: path.join(runDir, "report.md"),
      partial, failed_batches: failedBatches, files_sampled: filesSampled,
      excluded_dirs: current.excluded_dirs ?? [],
    };
  }
  const batchesTotal = manifest?.batches?.length ?? null;
  let batchesDone = 0;
  if (runDir && fs.existsSync(path.join(runDir, "done_extract"))) {
    batchesDone = fs.readdirSync(path.join(runDir, "done_extract")).length;
  }
  const judging = batchesTotal !== null && batchesDone === batchesTotal
    && fs.existsSync(path.join(runDir, "pairs.jsonl"));
  let judgeDone = 0;
  if (judging && fs.existsSync(path.join(runDir, "done_judge"))) {
    judgeDone = fs.readdirSync(path.join(runDir, "done_judge")).length;
  }
  if (!pidAlive(current.pid)) return failedStatus();
  return {
    state: "running", vault: current.vault, started_at: current.started_at,
    excluded_dirs: current.excluded_dirs ?? [],
    findings: partialFindings(runDir),
    progress: judging
      ? { phase: "judge", batches_done: batchesDone, batches_total: batchesTotal, judge_done: judgeDone, judge_total: lastJudgeTotal(home) }
      : { phase: "extract", batches_done: batchesDone, batches_total: batchesTotal },
  };
}

export function readCheckupReport(home, { locale } = {}) {
  const status = checkupStatus(home);
  if (!status.report_file || !fs.existsSync(status.report_file)) throw codedError(ERR.E_NOT_FOUND, translator(locale)("checkup.report_missing"));
  return { report: fs.readFileSync(status.report_file, "utf8") };
}

export function dismissCheckup(home) {
  const current = readCurrent(home) ?? {};
  writeCurrent(home, { ...current, state: "dismissed" });
  return { ok: true };
}

// 처방 ①: 진단에서 뽑은 fact를 nautli 저장소로 가져온다 (쓰기 게이트 경유 = 중복은 게이트가 거른다)
export function importCheckup(home, config, { locale } = {}) {
  const t = translator(locale);
  const current = readCurrent(home);
  if (!current) throw codedError(ERR.E_NOT_FOUND, t("checkup.import_missing"));
  if (current.imported_at) return current.imported;
  const runDir = current.run_dir;
  if (!summaryIsFresh(current, runDir)) {
    throw codedError(ERR.E_NOT_FOUND, t("checkup.memories_missing"));
  }
  const atoms = runDir ? readJsonl(path.join(runDir, "atoms.jsonl")) : [];
  if (atoms.length === 0) throw codedError(ERR.E_NOT_FOUND, t("checkup.memories_missing"));
  const store = new Store(home);
  const atomFactIds = new Map();
  const atomsById = new Map(atoms.map((atom) => [atom.id, atom]));
  const result = { imported: 0, duplicates: 0, rejected: 0, cards: 0, total: Math.min(atoms.length, IMPORT_CAP), omitted: Math.max(0, atoms.length - IMPORT_CAP) };
  try {
    for (const atom of atoms.slice(0, IMPORT_CAP)) {
      const originalScope = atom.type === "procedural" ? "procedure" : String(atom.scope ?? "");
      const cleanedScope = originalScope.trim().replace(/\s+/gu, "-").replace(/[^\p{L}\p{N}:_.-]+/gu, "-");
      const scope = validScope(originalScope) ? originalScope : validScope(cleanedScope) ? cleanedScope : "project:vault";
      const input = { claim: atom.claim, scope, subject: atom.subject || undefined, source: "checkup" };
      const validAt = atom.t_valid ?? atom.date;
      if (typeof validAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(validAt)) input.t_valid = validAt;
      try {
        const outcome = remember(store, input, config);
        if (outcome.status === "added") {
          result.imported += 1;
          atomFactIds.set(atom.id, outcome.id);
        } else if (outcome.reason === ERR.W_DUPLICATE) {
          result.duplicates += 1;
          atomFactIds.set(atom.id, outcome.id);
        } else result.rejected += 1;
      } catch {
        result.rejected += 1;
      }
    }
  } finally {
    store.close();
  }
  const cards = readJsonl(path.join(runDir, "judgments.jsonl")).flatMap((judgment) => {
    const atomIds = typeof judgment.pair_id === "string" ? judgment.pair_id.split("|") : [];
    const factIdA = atomFactIds.get(atomIds[0]);
    const factIdB = atomFactIds.get(atomIds[1]);
    const atomA = atomsById.get(atomIds[0]);
    const atomB = atomsById.get(atomIds[1]);
    const confidence = Number(judgment.confidence);
    const reviewable = (judgment.verdict === "duplicate" && confidence >= 0.6 && confidence < 0.9)
      || (judgment.verdict === "contradiction" && confidence >= 0.6);
    // 게이트 dedup으로 두 atom이 같은 fact로 접히면 자기쌍(x:x) 카드가 되므로 제외
    if (!reviewable || !factIdA || !factIdB || factIdA === factIdB || !atomA || !atomB) return [];
    return [{
      pair_id: `${factIdA}:${factIdB}`,
      verdict: judgment.verdict,
      confidence: judgment.confidence,
      newer: judgment.newer,
      reason: judgment.reason,
      claims: { a: atomA.claim, b: atomB.claim },
      status: "pending",
      source: "checkup",
    }];
  });
  result.cards = appendCards(home, cards);
  writeCurrent(home, { ...current, imported_at: new Date().toISOString(), imported: result });
  return result;
}
