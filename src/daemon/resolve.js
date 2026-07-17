import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { remember } from "../core/gate.js";
import { withReviewLock } from "../core/review-lock.js";
import { STATUS } from "../core/schema.js";
import { appendRawLog, buildCommand, extractJsonObjects } from "./judge.js";

export const RESOLVE_PROMPT = `[출력 규칙 최우선] 너의 응답(stdout)은 기계 파서에 그대로 들어간다. JSONL 외 어떤 텍스트(인사·설명·질문·코드펜스)도 출력하지 마라. 도구 사용·파일 읽기 금지. 입력만 보고 판정하라.

너는 개인 메모리 시스템의 머신 오라클 리졸버다. 사람이 답하지 않아도 되는 리뷰 카드를 관련 기억과 날짜까지 조사해 실제로 판결하라.

판결 원칙:
- 카드 문장만 보지 말고 evidence의 claim, scope, t_valid, status를 함께 대조하라.
- 증거가 카드 밖에서 답을 확정할 때만 판결하라. 정황이나 추측만으로 한쪽을 고르지 마라.
- evidence가 없거나 서로 충돌하거나 답을 확정하지 못하면 unresolved다. 과잉 판결하지 마라.
- pair decision은 a_wins, b_wins, both_invalid, both_valid, needs_human, unresolved 중 하나다.
- capture decision은 remember, discard, needs_human, unresolved 중 하나다.
- evidence_summary는 모든 출력에 필수다. 무엇을 어떤 날짜와 범위의 증거로 판단했는지 한 문장으로 설명하라.
- confidence는 0부터 1 사이다. 확실한 외부 증거가 있을 때만 0.8 이상을 주라.
- needs_human은 증거 조사로도 사람의 의도나 결정을 확인해야 할 때만 사용한다.
- needs_human일 때만 crux_plain, context_plain, recommend, recommend_reason_plain 네 필드를 모두 출력하라.
- crux_plain은 무엇을 확인해야 하는지 비개발자가 읽는 쉬운말 한 문장이다.
- context_plain은 언제 어떤 작업 중 나온 내용인지 쉬운말 한 문장이다.
- recommend는 사람이 고르기 쉽게 권하는 답이며 모르면 none이다.
- recommend_reason_plain은 추천 이유를 쉬운말 한 문장으로 설명한다.
- 쉬운말 네 필드에는 전문용어, 줄표, 호칭을 쓰지 마라.

입력: JSONL. pair는 {pair_id, kind:"pair", verdict, crux, claim_a, claim_b, scope, evidence:[{id,claim,scope,t_valid,status}]}, capture는 {pair_id, kind:"capture", verdict, crux, claim, scope, evidence:[{id,claim,scope,t_valid,status}]}다. evidence는 최대 8개다.

출력: JSONL만, 줄당 컴팩트 JSON 1개, 여러 줄로 펼치지 말 것.
{"pair_id":"...","decision":"a_wins|b_wins|both_invalid|both_valid|needs_human|unresolved","evidence_summary":"판단에 쓴 증거 한 문장","confidence":0.9,"crux_plain":"needs_human일 때만","context_plain":"needs_human일 때만","recommend":"needs_human일 때만","recommend_reason_plain":"needs_human일 때만"}
`;

const PAIR_DECISIONS = new Set([
  "a_wins",
  "b_wins",
  "both_invalid",
  "both_valid",
  "needs_human",
  "unresolved",
]);
const CAPTURE_DECISIONS = new Set(["remember", "discard", "needs_human", "unresolved"]);
const ROUTES = new Set(["machine", "auto", "hold"]);
const BATCH_SIZE = 10;
const TIMEOUT_MS = 300_000;

function queueFile(home) {
  return path.join(home, "review", "queue.jsonl");
}

function readQueue(home) {
  const file = queueFile(home);
  if (!fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    entries.push(JSON.parse(line));
  }
  return entries;
}

function writeQueue(home, entries) {
  const file = queueFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const data = entries.length === 0
    ? ""
    : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function pairFactIds(entry) {
  if (entry.type === "capture" || typeof entry.pair_id !== "string") return [];
  const ids = entry.pair_id.split(":");
  return ids.length === 2 ? ids : [];
}

export function buildEvidence(store, texts, scope, excludeIds = []) {
  const claims = Array.isArray(texts)
    ? texts.filter((text) => typeof text === "string" && text.trim() !== "")
    : [];
  const excluded = new Set(excludeIds);
  const matches = new Map();
  for (const claim of claims) {
    const searches = scope === undefined || scope === null || scope === ""
      ? [store.searchFts(claim, { limit: 8 })]
      : [
        store.searchFts(claim, { scope, limit: 8 }),
        store.searchFts(claim, { limit: 8 }),
      ];
    for (const [searchIndex, results] of searches.entries()) {
      for (const result of results) {
        if (excluded.has(result.id)) continue;
        const current = matches.get(result.id);
        const candidate = {
          rank: Number.isFinite(result.rank) ? result.rank : Number.POSITIVE_INFINITY,
          scoped: searchIndex === 0 && searches.length === 2,
        };
        if (!current
          || candidate.rank < current.rank
          || (candidate.rank === current.rank && candidate.scoped && !current.scoped)) {
          matches.set(result.id, candidate);
        }
      }
    }
  }
  return [...matches.entries()]
    .sort((left, right) => left[1].rank - right[1].rank
      || Number(right[1].scoped) - Number(left[1].scoped)
      || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .flatMap(([id]) => {
      const fact = store.getFact(id);
      return fact ? [{
        id: fact.id,
        claim: fact.claim,
        scope: fact.scope,
        t_valid: fact.t_valid,
        status: fact.status,
      }] : [];
    });
}

function inputCard(entry, store) {
  if (entry.type === "capture") {
    return {
      pair_id: entry.pair_id,
      kind: "capture",
      verdict: entry.verdict ?? "capture",
      crux: entry.crux ?? "",
      claim: entry.claim,
      scope: entry.scope,
      evidence: buildEvidence(
        store,
        [entry.claim],
        entry.scope,
        typeof entry.fact_id === "string" ? [entry.fact_id] : [],
      ),
    };
  }
  const ids = pairFactIds(entry);
  const a = ids.length === 2 ? store.getFact(ids[0]) : null;
  const b = ids.length === 2 ? store.getFact(ids[1]) : null;
  const claimA = a?.claim ?? entry.claims?.a;
  const claimB = b?.claim ?? entry.claims?.b;
  const scope = a?.scope === b?.scope
    ? a?.scope
    : entry.scope ?? a?.scope ?? b?.scope;
  return {
    pair_id: entry.pair_id,
    kind: "pair",
    verdict: entry.verdict,
    crux: entry.crux ?? "",
    claim_a: claimA,
    claim_b: claimB,
    scope,
    evidence: buildEvidence(store, [claimA, claimB], scope, ids),
  };
}

function validPlain(value) {
  return typeof value === "string" && value.trim() !== "" && !/[—–]/u.test(value);
}

function normalizeDecision(value, card) {
  if (!value || typeof value !== "object" || value.pair_id !== card.pair_id) return null;
  const decisions = card.kind === "capture" ? CAPTURE_DECISIONS : PAIR_DECISIONS;
  const confidence = typeof value.confidence === "number"
    ? value.confidence
    : Number(value.confidence);
  if (!decisions.has(value.decision)
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
    || typeof value.evidence_summary !== "string"
    || value.evidence_summary.trim() === "") return null;
  if (value.decision === "needs_human"
    && (!validPlain(value.crux_plain)
      || !validPlain(value.context_plain)
      || typeof value.recommend !== "string"
      || value.recommend.trim() === ""
      || !validPlain(value.recommend_reason_plain))) return null;
  return {
    pair_id: value.pair_id,
    decision: value.decision,
    evidence_summary: value.evidence_summary.trim(),
    confidence,
    ...(value.decision === "needs_human" ? {
      crux_plain: value.crux_plain.trim(),
      context_plain: value.context_plain.trim(),
      recommend: value.recommend.trim(),
      recommend_reason_plain: value.recommend_reason_plain.trim(),
    } : {}),
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
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("Resolve timed out after 300 seconds"));
        return;
      }
      if (code !== 0) {
        const error = new Error(`Resolve exited with ${code ?? signal}`);
        error.rawStdout = stdout;
        error.rawStderr = stderr;
        reject(error);
        return;
      }
      const expected = new Map(batch.map((card) => [card.pair_id, card]));
      const decisions = new Map();
      for (const candidate of extractJsonObjects(stdout)) {
        const card = expected.get(candidate?.pair_id);
        if (!card || decisions.has(card.pair_id)) continue;
        const decision = normalizeDecision(candidate, card);
        if (decision) decisions.set(card.pair_id, decision);
      }
      resolve({ decisions, parsedCount: decisions.size, rawStdout: stdout, rawStderr: stderr });
    });
    child.stdin.end(input);
  });
}

export function command(config) {
  return buildCommand(config, "resolve_cmd", RESOLVE_PROMPT);
}

async function resolveBatches(cards, config, home) {
  const invocation = command(config);
  const rawLog = path.join(home, "daemon", "resolve-raw.log");
  const sandbox = path.join(home, "daemon", "resolve-sandbox");
  fs.mkdirSync(sandbox, { recursive: true });
  const decisions = new Map();
  for (let offset = 0; offset < cards.length; offset += BATCH_SIZE) {
    const batch = cards.slice(offset, offset + BATCH_SIZE);
    try {
      let result;
      let retried = false;
      try {
        result = await runBatch(batch, invocation, sandbox);
      } catch (error) {
        retried = true;
        appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset} RETRY (${error.message})\nstdout:\n${error.rawStdout ?? ""}\nstderr:\n${error.rawStderr ?? ""}\n`);
        result = await runBatch(batch, invocation, sandbox);
      }
      if (!retried && result.parsedCount === 0 && batch.length > 0) {
        appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset} RETRY (0 parsed)\nstdout:\n${result.rawStdout}\nstderr:\n${result.rawStderr}\n`);
        result = await runBatch(batch, invocation, sandbox);
      }
      appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset}\nstdout:\n${result.rawStdout}\nstderr:\n${result.rawStderr}\n`);
      for (const [pairId, decision] of result.decisions) decisions.set(pairId, decision);
    } catch (error) {
      appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset} FAILED: ${error.message}\nstdout:\n${error.rawStdout ?? ""}\nstderr:\n${error.rawStderr ?? ""}\n`);
      // fail-open: 이 배치의 카드는 routed 상태로 남겨 다음 야간 실행에서 다시 조사한다.
    }
  }
  return decisions;
}

function emptyStats(checked = 0) {
  return { checked, resolved: 0, remembered: 0, discarded: 0, promoted: 0, unresolved: 0 };
}

function attachDetails(stats, details) {
  Object.defineProperty(stats, "decisions", { value: details, enumerable: false });
  return stats;
}

export async function resolveRoutedQueue(store, home, config, { cap = 40 } = {}) {
  const limit = Math.max(0, Math.trunc(Number(cap) || 0));
  const selected = withReviewLock(home, () => readQueue(home)
    .filter((entry) => entry.status === "routed" && ROUTES.has(entry.route))
    .slice(0, limit));
  if (selected.length === 0) return attachDetails(emptyStats(), []);

  const cards = selected.map((entry) => inputCard(entry, store));
  const decisions = await resolveBatches(cards, config, home);
  const selectedIds = new Set(selected.map((entry) => entry.pair_id));
  const stats = emptyStats(selected.length);
  const details = [];

  withReviewLock(home, () => {
    const queue = readQueue(home);
    let changed = false;
    const updated = queue.map((entry) => {
      if (!selectedIds.has(entry.pair_id)
        || entry.status !== "routed"
        || !ROUTES.has(entry.route)) return entry;
      const result = decisions.get(entry.pair_id);
      if (!result) {
        stats.unresolved += 1;
        return entry;
      }
      const decision = result.confidence < 0.8 ? "unresolved" : result.decision;
      if (decision === "unresolved") {
        stats.unresolved += 1;
        changed = true;
        return { ...entry, evidence: result.evidence_summary };
      }

      const handledAt = new Date().toISOString();
      try {
        if (entry.type === "capture") {
          if (decision === "remember") {
            const remembered = remember(store, {
              claim: entry.claim,
              scope: entry.scope,
              confidence: entry.confidence,
              source: "capture",
              provenance: {
                session_id: entry.session_id,
                project: entry.project,
              },
            }, config);
            if (remembered.status !== "added" && remembered.status !== "duplicate") {
              throw new Error(remembered.reason);
            }
            stats.remembered += 1;
            changed = true;
            details.push({
              pair_id: entry.pair_id,
              decision,
              evidence_summary: result.evidence_summary,
            });
            return {
              ...entry,
              status: "answered",
              action: decision,
              answered_by: "oracle",
              evidence: result.evidence_summary,
              handled_at: handledAt,
              fact_id: remembered.id,
            };
          }
          if (decision === "discard") {
            stats.discarded += 1;
            changed = true;
            details.push({
              pair_id: entry.pair_id,
              decision,
              evidence_summary: result.evidence_summary,
            });
            return {
              ...entry,
              status: "dismissed",
              action: decision,
              answered_by: "oracle",
              evidence: result.evidence_summary,
              handled_at: handledAt,
            };
          }
        } else if (["a_wins", "b_wins", "both_invalid", "both_valid"].includes(decision)) {
          const ids = pairFactIds(entry);
          const a = ids.length === 2 ? store.getFact(ids[0]) : null;
          const b = ids.length === 2 ? store.getFact(ids[1]) : null;
          if (!a || !b) throw new Error("Review pair facts are missing");
          if (decision === "a_wins" || decision === "b_wins") {
            const winner = decision === "a_wins" ? a : b;
            const loser = decision === "a_wins" ? b : a;
            if (loser.status === STATUS.ACTIVE) {
              store.transition(loser.id, STATUS.INVALIDATED, {
                t_invalid: winner.t_valid,
              }, "daemon");
            }
          } else if (decision === "both_invalid") {
            const today = new Date().toLocaleDateString("sv-SE");
            if (a.status === STATUS.ACTIVE) {
              store.transition(a.id, STATUS.INVALIDATED, { t_invalid: today }, "daemon");
            }
            if (b.status === STATUS.ACTIVE) {
              store.transition(b.id, STATUS.INVALIDATED, { t_invalid: today }, "daemon");
            }
          }
          stats.resolved += 1;
          changed = true;
          details.push({
            pair_id: entry.pair_id,
            decision,
            evidence_summary: result.evidence_summary,
          });
          return {
            ...entry,
            status: "answered",
            action: decision,
            answered_by: "oracle",
            evidence: result.evidence_summary,
            handled_at: handledAt,
          };
        }

        if (decision === "needs_human") {
          stats.promoted += 1;
          changed = true;
          return {
            ...entry,
            status: "pending",
            crux_plain: result.crux_plain,
            context_plain: result.context_plain,
            recommend: result.recommend,
            recommend_reason_plain: result.recommend_reason_plain,
            evidence: result.evidence_summary,
            promoted_by: "oracle",
          };
        }
      } catch {
        // fact 전이 또는 remember 실패는 큐를 닫지 않고 다음 실행에서 다시 시도한다.
      }
      stats.unresolved += 1;
      return entry;
    });
    if (changed) writeQueue(home, updated);
  });

  return attachDetails(stats, details);
}
