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

export function validateVaultPath(vaultPath, { userHome = os.homedir(), home } = {}) {
  if (typeof vaultPath !== "string" || vaultPath.trim() === "") throw codedError(ERR.E_INVALID_INPUT, "진단할 폴더 경로를 입력해 주세요.");
  let resolved;
  let resolvedUserHome;
  let resolvedHome;
  try {
    resolved = fs.realpathSync(path.resolve(vaultPath.replace(/^~(?=\/|$)/, userHome)));
  } catch {
    throw codedError(ERR.E_NOT_FOUND, "폴더를 찾을 수 없어요. 경로를 확인해 주세요.");
  }
  // userHome/NAUTLI_HOME이 아직 없을 수 있다(생짜 신규 유저) — 경계 기준은 존재하면 canonical, 없으면 resolve로
  const canonical = (p) => { try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); } };
  resolvedUserHome = canonical(userHome);
  resolvedHome = home ? canonical(home) : null;
  if (!fs.statSync(resolved).isDirectory()) throw codedError(ERR.E_NOT_FOUND, "폴더를 찾을 수 없어요. 경로를 확인해 주세요.");
  const userRelative = path.relative(resolvedUserHome, resolved);
  if (userRelative.startsWith(`..${path.sep}`) || userRelative === ".." || path.isAbsolute(userRelative)) throw codedError(ERR.E_INVALID_INPUT, "내 홈 폴더 안의 경로만 진단할 수 있어요.");
  if (resolvedHome) {
    const homeRelative = path.relative(resolvedHome, resolved);
    if (homeRelative === "" || (!homeRelative.startsWith(`..${path.sep}`) && homeRelative !== ".." && !path.isAbsolute(homeRelative))) throw codedError(ERR.E_INVALID_INPUT, "nautli 저장소 자신은 진단 대상이 아니에요.");
  }
  return resolved;
}

export function startCheckup(home, vaultPath, { userHome = os.homedir(), spawner = spawn } = {}) {
  const resolved = validateVaultPath(vaultPath, { userHome, home });
  if (countNotes(resolved, 1) === 0) throw codedError(ERR.E_INVALID_INPUT, "마크다운 노트가 없는 폴더예요.");
  const existing = readCurrent(home);
  if (existing && existing.state === "running" && pidAlive(existing.pid)) {
    throw codedError(ERR.E_STORE_BUSY, "진단이 이미 돌고 있어요. 끝나면 결과가 여기 떠요.");
  }
  const python = spawnSync("python3", ["--version"], { stdio: "ignore" });
  if (python.error || python.status !== 0) throw codedError(ERR.E_INVALID_INPUT, "python3가 필요해요. macOS는 xcode-select --install 로 설치할 수 있어요.");
  const workHome = path.join(checkupHome(home), "doctor");
  fs.mkdirSync(workHome, { recursive: true });
  const slug = `${path.basename(resolved)}-${createHash("sha1").update(resolved).digest("hex").slice(0, 6)}-s${TASTE.maxFiles}`;
  const runDir = path.resolve(workHome, "runs", slug);
  const logPath = path.join(checkupHome(home), "checkup.log");
  const log = fs.openSync(logPath, "a");
  const args = [
    DOCTOR_SCRIPT, resolved,
    "--work-home", workHome,
    "--max-files", String(TASTE.maxFiles),
    "--junk-sample", String(TASTE.junkSample),
    "--max-judge-pairs", String(TASTE.maxJudgePairs),
  ];
  if (fs.existsSync(runDir)) args.push("--fresh");
  const child = spawner("python3", args, { detached: true, stdio: ["ignore", log, log] });
  const started = {
    state: "running", vault: resolved, work_home: workHome, run_dir: runDir,
    started_at: new Date().toISOString(), pid: child.pid ?? null, mode: "taste",
  };
  child.on?.("error", (error) => {
    writeCurrent(home, { ...started, state: "failed", error: `python3 진단을 시작하지 못했어요. ${error.message || "실행 상태를 확인해 주세요."}` });
  });
  child.unref?.();
  fs.closeSync(log);
  writeCurrent(home, started);
  return { ok: true, started: true, vault: resolved, pid: child.pid ?? null };
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

export function checkupStatus(home) {
  const current = readCurrent(home);
  if (!current) return { state: "none" };
  if (current.state === "dismissed") return { state: "dismissed" };
  const failedStatus = () => {
    const logTail = readLogTail(home).split("\n").filter((line) => line.trim()).slice(-3).join("\n");
    return { state: "failed", vault: current.vault, log_tail: current.error || logTail };
  };
  const startedAt = Date.parse(current.started_at);
  const timedOut = current.state === "running" && Number.isFinite(startedAt) && Date.now() - startedAt >= 90 * 60 * 1000;
  if (current.state === "failed" || timedOut) return failedStatus();
  const runDir = current.run_dir;
  const manifest = runDir ? readJson(path.join(runDir, "manifest.json")) : null;
  const filesSampled = typeof manifest?.files === "number" ? manifest.files : null;
  const summary = runDir ? readJson(path.join(runDir, "summary.json")) : null;
  if (summary) {
    const failedBatches = summary.failed_extract_batches ?? 0;
    const partial = failedBatches > 0 || ((summary.notes ?? 0) > 0 && (summary.atoms ?? 0) === 0);
    return {
      state: current.imported_at ? "imported" : "done",
      vault: current.vault, summary, cards: topCards(runDir),
      imported: current.imported ?? null, report_file: path.join(runDir, "report.md"),
      partial, failed_batches: failedBatches, files_sampled: filesSampled,
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
    progress: judging
      ? { phase: "judge", batches_done: batchesDone, batches_total: batchesTotal, judge_done: judgeDone, judge_total: lastJudgeTotal(home) }
      : { phase: "extract", batches_done: batchesDone, batches_total: batchesTotal },
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
  if (current.imported_at) return current.imported;
  const runDir = current.run_dir;
  const atoms = runDir ? readJsonl(path.join(runDir, "atoms.jsonl")) : [];
  if (atoms.length === 0) throw codedError(ERR.E_NOT_FOUND, "진단에서 추출된 기억이 없어요.");
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
