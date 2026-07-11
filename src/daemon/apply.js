import fs from "node:fs";
import path from "node:path";
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
    .map((entry) => entry.pair_id)
    .filter((value) => typeof value === "string"));
  const queue = readJsonl(queueFile);
  const queuedPairs = new Set(queue
    .map((entry) => entry.pair_id)
    .filter((value) => typeof value === "string"));
  let applied = 0;
  let queued = 0;
  let skipped = 0;
  const journalEntries = [];

  for (const judgment of judgments) {
    if (completed.has(judgment?.pair_id)) {
      skipped += 1;
      continue;
    }

    const ids = factIds(judgment?.pair_id);
    const a = ids ? store.getFact(ids[0]) : null;
    const b = ids ? store.getFact(ids[1]) : null;
    const confidence = Number(judgment?.confidence);
    let outcome = "skipped";

    if (a?.status === STATUS.ACTIVE && b?.status === STATUS.ACTIVE) {
      if (judgment.verdict === "duplicate" && confidence >= 0.9) {
        const selected = olderDuplicate(a, b);
        if (selected) {
          const [oldFact, newFact] = selected;
          store.transition(oldFact.id, STATUS.SUPERSEDED, {
            superseded_by: newFact.id,
          }, "daemon");
          applied += 1;
          outcome = "applied";
        }
      } else if (judgment.verdict === "contradiction"
        // v0 정책(유저 라벨 실측 2026-07-11): 모순은 기본 자동 적용 금지 — 항상 리뷰카드.
        // 자동병합(중복) 정밀도는 10/10이었지만 모순 자동무효화는 5장 중 2장이 유저 정정을 받음
        // (죽은 프로젝트 통째 보관 신호 1, 기록과 다른 현재 의도 1). opt-in: config.contradiction_auto=true
        && config.contradiction_auto === true
        && confidence >= 0.9
        && (judgment.newer === "a" || judgment.newer === "b")) {
        const newFact = judgment.newer === "a" ? a : b;
        const oldFact = judgment.newer === "a" ? b : a;
        store.transition(oldFact.id, STATUS.INVALIDATED, {
          t_invalid: newFact.t_valid,
        }, "daemon");
        applied += 1;
        outcome = "applied";
      } else if ((judgment.verdict === "duplicate" && confidence >= 0.6 && confidence < 0.9)
        // 모순은 conf ≥0.6이면 전부 리뷰카드행 (자동 적용은 위 opt-in 분기에서만)
        || (judgment.verdict === "contradiction" && confidence >= 0.6)) {
        if (!queuedPairs.has(judgment.pair_id)) {
          queue.push({
            ...judgment,
            claims: { a: a.claim, b: b.claim },
            status: "pending",
          });
          queuedPairs.add(judgment.pair_id);
          queued += 1;
        }
        outcome = "queued";
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

    return { applied, queued, skipped };
  });
}
