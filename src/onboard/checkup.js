import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ERR } from "../core/schema.js";
import { Store } from "../core/store.js";
import { remember } from "../core/gate.js";

const DOCTOR_SCRIPT = fileURLToPath(new URL("../../vendor/vault-doctor/vault_doctor.py", import.meta.url));
// 맛보기 진단 기본 캡 — 온보딩은 "몇 분" 안에 끝나야 한다 (풀 진단은 CLI 몫)
export const TASTE = Object.freeze({ maxFiles: 40, junkSample: 12, maxJudgePairs: 150 });
const IMPORT_CAP = 800;

function codedError(code, message) {
  const error = new Error(message ?? code);
  error.code = code;
  return error;
}

function countNotes(dir, cap = 4000) {
  let count = 0;
  const queue = [dir];
  while (queue.length > 0 && count < cap) {
    const current = queue.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory()) queue.push(path.join(current, entry.name));
      else if (entry.name.endsWith(".md")) count += 1;
    }
  }
  return count;
}

// 유저 홈에서 진단 후보를 찾는다: 옵시디언 볼트(.obsidian 폴더) + Claude 하네스(~/.claude)
export function checkupCandidates({ userHome = os.homedir(), roots, maxDepth = 3 } = {}) {
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
  const claudeHome = path.join(userHome, ".claude");
  if (fs.existsSync(path.join(claudeHome, "CLAUDE.md"))) {
    found.set(claudeHome, { path: claudeHome, kind: "claude-harness", label: "Claude 하네스 (~/.claude)" });
  }
  return [...found.values()].map((candidate) => ({ ...candidate, notes: countNotes(candidate.path) }))
    .filter((candidate) => candidate.notes > 0)
    .sort((a, b) => b.notes - a.notes)
    .slice(0, 8);
}

function checkupHome(home) {
  return path.join(home, "checkup");
}

function currentFile(home) {
  return path.join(checkupHome(home), "current.json");
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
  const temp = `${file}.tmp`;
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

export function validateVaultPath(vaultPath, { userHome = os.homedir(), home } = {}) {
  if (typeof vaultPath !== "string" || vaultPath.trim() === "") throw codedError(ERR.E_INVALID_INPUT, "진단할 폴더 경로를 입력해 주세요.");
  const resolved = path.resolve(vaultPath.replace(/^~(?=\/|$)/, userHome));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw codedError(ERR.E_NOT_FOUND, "폴더를 찾을 수 없어요. 경로를 확인해 주세요.");
  const homeBoundary = path.resolve(userHome) + path.sep;
  if (resolved !== path.resolve(userHome) && !resolved.startsWith(homeBoundary)) throw codedError(ERR.E_INVALID_INPUT, "내 홈 폴더 안의 경로만 진단할 수 있어요.");
  if (home && (resolved === path.resolve(home) || resolved.startsWith(path.resolve(home) + path.sep))) throw codedError(ERR.E_INVALID_INPUT, "nautli 저장소 자신은 진단 대상이 아니에요.");
  return resolved;
}

export function startCheckup(home, vaultPath, { userHome = os.homedir(), spawner = spawn } = {}) {
  const resolved = validateVaultPath(vaultPath, { userHome, home });
  const existing = readCurrent(home);
  if (existing && existing.state === "running" && pidAlive(existing.pid)) {
    throw codedError(ERR.E_STORE_BUSY, "진단이 이미 돌고 있어요. 끝나면 결과가 여기 떠요.");
  }
  const workHome = path.join(checkupHome(home), "doctor");
  fs.mkdirSync(workHome, { recursive: true });
  const logPath = path.join(checkupHome(home), "checkup.log");
  const log = fs.openSync(logPath, "a");
  const args = [
    DOCTOR_SCRIPT, resolved,
    "--work-home", workHome,
    "--max-files", String(TASTE.maxFiles),
    "--junk-sample", String(TASTE.junkSample),
    "--max-judge-pairs", String(TASTE.maxJudgePairs),
  ];
  const child = spawner("python3", args, { detached: true, stdio: ["ignore", log, log] });
  child.unref?.();
  fs.closeSync(log);
  writeCurrent(home, {
    state: "running", vault: resolved, work_home: workHome,
    started_at: new Date().toISOString(), pid: child.pid ?? null, mode: "taste",
  });
  return { ok: true, started: true, vault: resolved, pid: child.pid ?? null };
}

function findRunDir(workHome, vault) {
  const runs = path.join(workHome, "runs");
  if (!fs.existsSync(runs)) return null;
  const base = path.basename(vault.replace(/\/$/, ""));
  const dirs = fs.readdirSync(runs).filter((name) => name.startsWith(`${base}-`));
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => fs.statSync(path.join(runs, b)).mtimeMs - fs.statSync(path.join(runs, a)).mtimeMs);
  return path.join(runs, dirs[0]);
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

export function checkupStatus(home) {
  const current = readCurrent(home);
  if (!current) return { state: "none" };
  if (current.state === "dismissed") return { state: "dismissed" };
  const runDir = findRunDir(current.work_home, current.vault);
  const summary = runDir ? readJson(path.join(runDir, "summary.json")) : null;
  if (summary) {
    return {
      state: current.imported_at ? "imported" : "done",
      vault: current.vault, summary, cards: topCards(runDir),
      imported: current.imported ?? null, report_file: path.join(runDir, "report.md"),
    };
  }
  const manifest = runDir ? readJson(path.join(runDir, "manifest.json")) : null;
  const batchesTotal = manifest?.batches?.length ?? null;
  let batchesDone = 0;
  if (runDir && fs.existsSync(path.join(runDir, "done_extract"))) {
    batchesDone = fs.readdirSync(path.join(runDir, "done_extract")).length;
  }
  if (!pidAlive(current.pid)) {
    let logTail = "";
    try {
      const text = fs.readFileSync(path.join(checkupHome(home), "checkup.log"), "utf8");
      logTail = text.split("\n").filter((line) => line.trim()).slice(-3).join("\n");
    } catch { /* 로그 없으면 빈 값 */ }
    return { state: "failed", vault: current.vault, log_tail: logTail };
  }
  return {
    state: "running", vault: current.vault, started_at: current.started_at,
    progress: { batches_done: batchesDone, batches_total: batchesTotal },
  };
}

export function readCheckupReport(home) {
  const status = checkupStatus(home);
  if (!status.report_file || !fs.existsSync(status.report_file)) throw codedError(ERR.E_NOT_FOUND, "아직 리포트가 없어요.");
  return { report: fs.readFileSync(status.report_file, "utf8") };
}

export function dismissCheckup(home) {
  const current = readCurrent(home) ?? {};
  writeCurrent(home, { ...current, state: "dismissed" });
  return { ok: true };
}

// 처방 ①: 진단에서 뽑은 fact를 nautli 저장소로 가져온다 (쓰기 게이트 경유 = 중복은 게이트가 거른다)
export function importCheckup(home, config) {
  const current = readCurrent(home);
  if (!current) throw codedError(ERR.E_NOT_FOUND, "가져올 진단 결과가 없어요.");
  const runDir = findRunDir(current.work_home, current.vault);
  const atoms = runDir ? readJsonl(path.join(runDir, "atoms.jsonl")) : [];
  if (atoms.length === 0) throw codedError(ERR.E_NOT_FOUND, "진단에서 추출된 기억이 없어요.");
  const store = new Store(home);
  const result = { imported: 0, duplicates: 0, rejected: 0, total: Math.min(atoms.length, IMPORT_CAP) };
  try {
    for (const atom of atoms.slice(0, IMPORT_CAP)) {
      const scope = atom.type === "procedural" ? "procedure"
        : /^(person|procedure|project:.+)$/.test(atom.scope ?? "") ? atom.scope : "project:vault";
      const input = { claim: atom.claim, scope, subject: atom.subject || undefined, source: "checkup" };
      if (atom.date && /^\d{4}-\d{2}-\d{2}$/.test(atom.date)) input.t_valid = atom.date;
      try {
        const outcome = remember(store, input, config);
        if (outcome.status === "added") result.imported += 1;
        else if (outcome.reason === ERR.W_DUPLICATE) result.duplicates += 1;
        else result.rejected += 1;
      } catch {
        result.rejected += 1;
      }
    }
  } finally {
    store.close();
  }
  writeCurrent(home, { ...current, imported_at: new Date().toISOString(), imported: result });
  return result;
}
