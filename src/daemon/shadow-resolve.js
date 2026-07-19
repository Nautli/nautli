import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { withReviewLock } from "../core/review-lock.js";
import { STATUS } from "../core/schema.js";
import { remember } from "../core/gate.js";
import { appendRawLog, buildCommand, extractJsonObjects } from "./judge.js";
import { buildEvidence } from "./resolve.js";

// shadow-resolve: 밤 소화에서 shadow(검증 대기) 항목을 새 근거로 자동 해소한다.
// corroborate(새 독립 근거가 같은 결론 지지) → commit, contradict → 폐기(dismissed).
// person scope는 자동 commit 영구 금지.

export const SHADOW_RESOLVE_PROMPT = `[출력 규칙 최우선] 너의 응답(stdout)은 기계 파서에 그대로 들어간다. JSONL 외 어떤 텍스트(인사·설명·질문·코드펜스)도 출력하지 마라. 도구 사용·파일 읽기 금지. 입력만 보고 판정하라.

너는 개인 메모리 시스템의 shadow 검증기다. shadow(검증 대기) 항목마다 새로 추가된 증거(evidence)를 보고 원래 판정을 확인(corroborate)하거나 반박(contradict)하라.

판정 원칙:
- shadow 항목은 이전 소화에서 "중복" 또는 "모순"으로 판정됐으나 신뢰도가 낮아 보류된 것이다.
- evidence는 shadow 이후에 새로 추가된 관련 기억이다.
- 새 증거가 원래 판정(verdict)과 같은 결론을 독립적으로 지지하면 corroborate다.
- 새 증거가 원래 판정을 반박하면(예: 중복이 아님을 보여주거나, 모순이 아님을 보여줌) contradict다.
- 증거가 부족하거나 애매하면 no_signal이다. 과잉 판결하지 마라.
- confidence는 0부터 1 사이다. 확실한 외부 증거가 있을 때만 0.8 이상을 주라.

입력: JSONL. {undo_id, verdict, claim_a, claim_b, scope, newer, evidence:[{id,claim,scope,t_valid,status}]}
(capture 타입은 claim_a 대신 claim 필드)

출력: JSONL만, 줄당 컴팩트 JSON 1개.
{"undo_id":"...","decision":"corroborate|contradict|no_signal","evidence_summary":"판단에 쓴 증거 한 문장","confidence":0.9}
`;

const DECISIONS = new Set(["corroborate", "contradict", "no_signal"]);
const BATCH_SIZE = 10;
const TIMEOUT_MS = 300_000;

function undoLedgerFile(home) {
  return path.join(home, "review", "undo-ledger.jsonl");
}

function readUndoLedger(home) {
  const file = undoLedgerFile(home);
  if (!fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }
  return entries;
}

function writeUndoLedger(home, entries) {
  const file = undoLedgerFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const data = entries.length === 0 ? "" : `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export function findShadowCandidates(home, { cap = 20 } = {}) {
  const ledger = readUndoLedger(home);
  return ledger.filter((entry) => (
    entry.action === "shadow"
    && !entry.undone
    && !entry.confirmed_at
    && !entry.shadow_resolved_at
    // person scope는 자동 commit 영구 금지
    && entry.scope !== "person"
  )).slice(0, cap);
}

function buildInputCard(entry, store) {
  const excludeIds = Array.isArray(entry.fact_ids)
    ? entry.fact_ids.filter((id) => typeof id === "string")
    : [];

  // claim_a/claim_b가 ledger에 없을 수 있다 (초기 shadow 기록에서 누락) — store에서 조회
  let claimA = entry.claim_a;
  let claimB = entry.claim_b;
  if (entry.type !== "capture" && (!claimA || !claimB) && excludeIds.length === 2) {
    const a = store.getFact(excludeIds[0]);
    const b = store.getFact(excludeIds[1]);
    if (!claimA && a) claimA = a.claim;
    if (!claimB && b) claimB = b.claim;
  }

  // evidence: shadow 이후 추가된 fact 중 관련된 것 (buildEvidence가 FTS로 검색)
  const claims = entry.type === "capture"
    ? [entry.claim].filter(Boolean)
    : [claimA, claimB].filter(Boolean);

  const evidence = buildEvidence(store, claims, entry.scope, excludeIds);

  // shadow 이후에 추가된 증거만 필터 (applied_at 이후)
  const appliedAt = entry.applied_at;
  const filteredEvidence = appliedAt
    ? evidence.filter((e) => {
      const fact = store.getFact(e.id);
      return fact && fact.t_created > appliedAt;
    })
    : evidence;

  if (entry.type === "capture") {
    return {
      undo_id: entry.undo_id,
      verdict: entry.verdict ?? "capture",
      claim: entry.claim,
      scope: entry.scope,
      evidence: filteredEvidence,
    };
  }
  return {
    undo_id: entry.undo_id,
    verdict: entry.verdict,
    claim_a: claimA,
    claim_b: claimB,
    scope: entry.scope,
    newer: entry.newer,
    evidence: filteredEvidence,
  };
}

function normalizeDecision(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.undo_id !== "string") return null;
  if (!DECISIONS.has(value.decision)) return null;
  const confidence = typeof value.confidence === "number"
    ? value.confidence
    : Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (typeof value.evidence_summary !== "string" || value.evidence_summary.trim() === "") return null;
  return {
    undo_id: value.undo_id,
    decision: value.decision,
    evidence_summary: value.evidence_summary.trim(),
    confidence,
  };
}

function runBatch(batch, invocation, cwd) {
  const input = `${batch.map((card) => JSON.stringify(card)).join("\n")}\n`;
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.cmd, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("Shadow resolve timed out after 300 seconds"));
        return;
      }
      if (code !== 0) {
        const error = new Error(`Shadow resolve exited with ${code}`);
        error.rawStdout = stdout;
        error.rawStderr = stderr;
        reject(error);
        return;
      }
      const decisions = new Map();
      for (const candidate of extractJsonObjects(stdout)) {
        const decision = normalizeDecision(candidate);
        if (decision && !decisions.has(decision.undo_id)) {
          decisions.set(decision.undo_id, decision);
        }
      }
      resolve({ decisions, parsedCount: decisions.size, rawStdout: stdout, rawStderr: stderr });
    });
    child.stdin.end(input);
  });
}

export function command(config) {
  return buildCommand(config, "shadow_resolve_cmd", SHADOW_RESOLVE_PROMPT);
}

async function runBatches(cards, config, home) {
  const invocation = command(config);
  const rawLog = path.join(home, "daemon", "shadow-resolve-raw.log");
  const sandbox = path.join(home, "daemon", "shadow-resolve-sandbox");
  fs.mkdirSync(sandbox, { recursive: true });
  const decisions = new Map();
  for (let offset = 0; offset < cards.length; offset += BATCH_SIZE) {
    const batch = cards.slice(offset, offset + BATCH_SIZE);
    try {
      let result;
      try {
        result = await runBatch(batch, invocation, sandbox);
      } catch (error) {
        appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset} RETRY (${error.message})\n`);
        result = await runBatch(batch, invocation, sandbox);
      }
      appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset}\nstdout:\n${result.rawStdout}\nstderr:\n${result.rawStderr}\n`);
      for (const [id, decision] of result.decisions) decisions.set(id, decision);
    } catch (error) {
      appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset} FAILED: ${error.message}\n`);
    }
  }
  return decisions;
}

export async function resolveShadows(store, home, config, { cap = 20 } = {}) {
  const stats = { checked: 0, corroborated: 0, contradicted: 0, no_signal: 0 };

  const candidates = findShadowCandidates(home, { cap });
  if (candidates.length === 0) return stats;

  // 증거가 있는 항목만 LLM에 보낸다 (증거 0이면 no_signal 확정)
  const cards = [];
  const candidateMap = new Map();
  for (const entry of candidates) {
    const card = buildInputCard(entry, store);
    if (card.evidence.length === 0) {
      stats.no_signal += 1;
      stats.checked += 1;
      continue;
    }
    cards.push(card);
    candidateMap.set(entry.undo_id, entry);
  }

  if (cards.length === 0) return stats;

  const decisions = await runBatches(cards, config, home);
  stats.checked += cards.length;

  withReviewLock(home, () => {
    const ledger = readUndoLedger(home);
    let changed = false;
    const now = new Date().toISOString();

    for (const [undoId, result] of decisions) {
      const entry = candidateMap.get(undoId);
      if (!entry) continue;

      const decision = result.confidence < 0.8 ? "no_signal" : result.decision;

      if (decision === "no_signal") {
        stats.no_signal += 1;
        continue;
      }

      const index = ledger.findIndex((e) => e.undo_id === undoId);
      if (index < 0) continue;

      if (decision === "corroborate") {
        // Commit: apply the shadow as if user confirmed
        const committed = commitShadow(store, entry, ledger, index, now, result.evidence_summary);
        if (committed) {
          stats.corroborated += 1;
          changed = true;
        } else {
          stats.no_signal += 1;
        }
      } else if (decision === "contradict") {
        // Dismiss: mark as contradicted, don't apply
        ledger[index] = {
          ...ledger[index],
          action: "dismissed",
          shadow_resolved_at: now,
          shadow_resolved_by: "corroborate_daemon",
          shadow_decision: "contradict",
          shadow_evidence: result.evidence_summary,
        };
        stats.contradicted += 1;
        changed = true;
      }
    }

    // 판정 없는 카드는 no_signal
    for (const card of cards) {
      if (!decisions.has(card.undo_id)) {
        stats.no_signal += 1;
      }
    }

    if (changed) writeUndoLedger(home, ledger);
  });

  store.appendEvent({
    ev: "shadow.resolve_cycle",
    ...stats,
    at: new Date().toISOString(),
  });

  return stats;
}

function commitShadow(store, entry, ledger, index, now, evidenceSummary) {
  if (entry.type === "capture") {
    if (!entry.claim) return false;
    const result = remember(store, {
      claim: entry.claim,
      scope: entry.scope ?? undefined,
      confidence: entry.confidence ?? undefined,
      source: "capture",
    }, {});
    if (result.status !== "added" && result.status !== "duplicate") return false;
    ledger[index] = {
      ...ledger[index],
      action: "remember",
      ...(result.status === "added" && result.id ? { fact_id: result.id } : {}),
      shadow_resolved_at: now,
      shadow_resolved_by: "corroborate_daemon",
      shadow_decision: "corroborate",
      shadow_evidence: evidenceSummary,
    };
    return true;
  }

  // Pair type
  const ids = Array.isArray(entry.fact_ids) ? entry.fact_ids : [];
  if (ids.length !== 2) return false;
  const a = store.getFact(ids[0]);
  const b = store.getFact(ids[1]);
  if (!a || !b) return false;
  if (a.status !== STATUS.ACTIVE || b.status !== STATUS.ACTIVE) return false;

  // 명시됐는데 a/b가 아닌 오염값은 방향 불명 — commit 금지
  if (entry.newer != null && entry.newer !== "a" && entry.newer !== "b") return false;

  const newerFact = entry.newer === "a" ? a : entry.newer === "b" ? b : null;
  let winner;
  let loser;
  if (newerFact) {
    winner = newerFact;
    loser = winner.id === a.id ? b : a;
  } else if (entry.verdict === "duplicate") {
    // duplicate는 t_valid 폴백 허용
    [loser, winner] = a.t_valid <= b.t_valid ? [a, b] : [b, a];
  } else {
    // contradiction은 방향 없이 적용 금지
    return false;
  }

  let action;
  if (entry.verdict === "duplicate") {
    store.transition(loser.id, STATUS.SUPERSEDED, { superseded_by: winner.id }, "daemon");
    action = "merge";
  } else if (entry.verdict === "contradiction") {
    store.transition(loser.id, STATUS.INVALIDATED, { t_invalid: winner.t_valid }, "daemon");
    action = entry.newer === "a" ? "a_wins" : "b_wins";
  } else {
    return false;
  }

  ledger[index] = {
    ...ledger[index],
    action,
    before_state: [
      { id: loser.id, status: loser.status, claim: loser.claim },
      { id: winner.id, status: winner.status, claim: winner.claim },
    ],
    shadow_resolved_at: now,
    shadow_resolved_by: "corroborate_daemon",
    shadow_decision: "corroborate",
    shadow_evidence: evidenceSummary,
  };
  return true;
}
