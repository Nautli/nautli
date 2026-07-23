import fs from "node:fs";
import path from "node:path";
import { recordAutoApply } from "../core/review.js";
import { withReviewLock } from "../core/review-lock.js";
import { STATUS } from "../core/schema.js";

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const values = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      // A partial trailing line has not completed its operation.
    }
  }
  return values;
}

function factIds(pair_id) {
  if (typeof pair_id !== "string") return null;
  const ids = pair_id.split(":");
  return ids.length === 2 && ids.every((id) => id.startsWith("fa_")) ? ids : null;
}

function olderDuplicate(a, b) {
  if (a.t_valid !== b.t_valid) return a.t_valid < b.t_valid ? [a, b] : [b, a];
  if (a.confidence !== b.confidence) return a.confidence < b.confidence ? [a, b] : [b, a];
  return null;
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function writeJsonl(file, values) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const data = values.length === 0 ? "" : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export function applyJudgments(store, judgments, config = {}) {
  return withReviewLock(store.home, () => {
    const journalFile = path.join(store.home, "daemon", "journal.jsonl");
    const queueFile = path.join(store.home, "review", "queue.jsonl");
    const completed = new Set(readJsonl(journalFile)
      .filter((entry) => entry?.kind === "judgment")
      .map((entry) => entry.pair_id)
      .filter((value) => typeof value === "string"));
    const queue = readJsonl(queueFile);
    const queuedPairs = new Set(queue
      .map((entry) => entry.pair_id)
      .filter((value) => typeof value === "string"));
    let applied = 0;
    // TASK-061: 자동 병합과 모순 자동해결은 사용자 카피에서 다른 결과로 보여 준다.
    let appliedDuplicates = 0;
    let appliedContradictions = 0;
    let queued = 0;
    // TASK-013: related 판정은 기억 그래프 엣지로 영속화된다(자동 병합/모순과 별개 카운터).
    let appliedEdges = 0;
    let skipped = 0;
    let machineOracle = 0;
    let triageRouted = 0;
    let shadowed = 0;
    let failedPairs = 0;
    const journalEntries = [];

    for (const judgment of judgments) {
      if (completed.has(judgment?.pair_id)) {
        skipped += 1;
        continue;
      }

      if (judgment?.failed === true) {
        failedPairs += 1;
        journalEntries.push({
          kind: "judgment_failed",
          pair_id: judgment?.pair_id,
          verdict: judgment?.verdict,
          confidence: judgment?.confidence,
          outcome: "failed",
          at: new Date().toISOString(),
        });
        continue;
      }

      const ids = factIds(judgment?.pair_id);
      const a = ids ? store.getFact(ids[0]) : null;
      const b = ids ? store.getFact(ids[1]) : null;
      const confidence = Number(judgment?.confidence);
      let outcome = "skipped";

      if (a?.status === STATUS.ACTIVE && b?.status === STATUS.ACTIVE) {
        // T1: duplicate, conf≥0.9, scope≠person(양쪽 모두), no crux_plain → auto-merge + undo ledger
        const isT1 = judgment.verdict === "duplicate"
          && confidence >= 0.9
          && a.scope !== "person"
          && b.scope !== "person"
          && !judgment.crux_plain;

        if (isT1) {
          // 승자 방향은 judge의 newer 필드가 정본, t_valid 비교는 newer 부재 시 폴백 (GO 조건 ③).
          // 명시됐는데 a/b가 아닌 오염값은 부재 취급 금지 — 방향 불명으로 shadow 강등.
          const invalidNewer = judgment.newer != null
            && judgment.newer !== "a" && judgment.newer !== "b";
          const newerFact = judgment.newer === "a" ? a : judgment.newer === "b" ? b : null;
          const selected = invalidNewer
            ? null
            : newerFact
              ? (newerFact.id === a.id ? [b, a] : [a, b])
              : olderDuplicate(a, b);
          if (selected) {
            const [oldFact, newFact] = selected;
            const beforeState = [
              { id: oldFact.id, status: oldFact.status, claim: oldFact.claim },
              { id: newFact.id, status: newFact.status, claim: newFact.claim },
            ];
            // TASK-104: judge 자동적용 — reason은 judge:<verdict>, policy는 "n/a".
            store.transition(oldFact.id, STATUS.SUPERSEDED, {
              superseded_by: newFact.id,
            }, "daemon", { reason: `judge:${judgment.verdict}`, policy_version: "n/a" });
            recordAutoApply(store.home, {
              pair_id: judgment.pair_id,
              action: "merge",
              verdict: judgment.verdict,
              confidence,
              scope: a.scope,
              model: judgment.model ?? null,
              before_state: beforeState,
              fact_ids: [oldFact.id, newFact.id],
              claim_a: a.claim,
              claim_b: b.claim,
              type: "pair",
            });
            applied += 1;
            appliedDuplicates += 1;
            outcome = "applied";
          } else {
            // 승자 방향 판별 불가(newer 부재 + t_valid·confidence 동률) — 조용한 누락 대신 shadow로 강등
            recordAutoApply(store.home, {
              pair_id: judgment.pair_id,
              action: "shadow",
              verdict: judgment.verdict,
              confidence,
              scope: a.scope,
              model: judgment.model ?? null,
              before_state: [],
              fact_ids: [a.id, b.id],
              newer: judgment.newer,
              claim_a: a.claim,
              claim_b: b.claim,
              type: "pair",
            });
            shadowed += 1;
            outcome = "shadowed";
          }
        } else if (judgment.verdict === "contradiction"
          && config.contradiction_auto === true
          && confidence >= 0.9
          && (judgment.newer === "a" || judgment.newer === "b")) {
          // Legacy opt-in contradiction auto-apply (kept for backward compat)
          const newFact = judgment.newer === "a" ? a : b;
          const oldFact = judgment.newer === "a" ? b : a;
          const beforeState = [
            { id: oldFact.id, status: oldFact.status, claim: oldFact.claim },
            { id: newFact.id, status: newFact.status, claim: newFact.claim },
          ];
          // TASK-104: judge 자동적용(모순) — reason은 judge:<verdict>, policy는 "n/a".
          store.transition(oldFact.id, STATUS.INVALIDATED, {
            t_invalid: newFact.t_valid,
          }, "daemon", { reason: `judge:${judgment.verdict}`, policy_version: "n/a" });
          const winAction = judgment.newer === "a" ? "a_wins" : "b_wins";
          recordAutoApply(store.home, {
            pair_id: judgment.pair_id,
            action: winAction,
            verdict: judgment.verdict,
            confidence,
            scope: a.scope,
            model: judgment.model ?? null,
            before_state: beforeState,
            fact_ids: [a.id, b.id],
            claim_a: a.claim,
            claim_b: b.claim,
            type: "pair",
          });
          applied += 1;
          appliedContradictions += 1;
          outcome = "applied";
        } else if ((judgment.verdict === "duplicate" && confidence < 0.9)
          || judgment.verdict === "contradiction"
          || (judgment.verdict === "duplicate" && confidence >= 0.9
            && (a.scope === "person" || b.scope === "person" || judgment.crux_plain))) {
          // 티어 표 기준 저신뢰 하한 없음: contradiction 전부, duplicate<0.9 전부 shadow (confidence NaN은 위 비교가 false라 자연 제외)
          // Zero-touch: instead of queuing for human review, record as shadow in undo ledger
          if (judgment.oracle === "machine") {
            machineOracle += 1;
            outcome = "skipped_machine_oracle";
          } else if (judgment.route === "machine" || judgment.route === "auto") {
            triageRouted += 1;
            outcome = "skipped_triage";
          } else {
            // Shadow: record in undo ledger but don't apply or push to user
            recordAutoApply(store.home, {
              pair_id: judgment.pair_id,
              action: "shadow",
              verdict: judgment.verdict,
              confidence,
              scope: a.scope,
              model: judgment.model ?? null,
              before_state: [],
              fact_ids: [a.id, b.id],
              newer: judgment.newer,
              claim_a: a.claim,
              claim_b: b.claim,
              type: "pair",
            });
            shadowed += 1;
            outcome = "shadowed";
          }
        } else if (judgment.verdict === "related") {
          // TASK-013: 야간 데몬 related 판정을 기억 그래프 엣지로 저장(edge.upserted 이벤트).
          // 정규화·ev_id·idempotent upsert는 store.upsertEdge가 처리한다.
          store.upsertEdge({
            a_id: a.id,
            b_id: b.id,
            kind: "related",
            confidence,
            source: "judge",
          });
          appliedEdges += 1;
          outcome = "edge";
        }
      }

      if (outcome === "skipped") skipped += 1;
      journalEntries.push({
        kind: "judgment",
        pair_id: judgment?.pair_id,
        verdict: judgment?.verdict,
        confidence: judgment?.confidence,
        outcome,
        at: new Date().toISOString(),
      });
      if (typeof judgment?.pair_id === "string") completed.add(judgment.pair_id);
    }

    if (queued > 0) writeJsonl(queueFile, queue);
    for (const entry of journalEntries) appendJsonl(journalFile, entry);

    const results = {
      applied,
      applied_duplicates: appliedDuplicates,
      applied_contradictions: appliedContradictions,
      // TASK-013: 이번 소화에서 저장된 related 엣지 수.
      edges: appliedEdges,
      queued,
      shadowed,
      skipped,
      machine_oracle: machineOracle,
      triage_routed: triageRouted,
    };
    if (failedPairs > 0) results.failed_pairs = failedPairs;
    else Object.defineProperty(results, "failed_pairs", { value: 0, enumerable: false });
    return results;
  });
}
