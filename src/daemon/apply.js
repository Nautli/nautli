import fs from "node:fs";
import path from "node:path";
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

export function applyJudgments(store, judgments) {
  const journalFile = path.join(store.home, "daemon", "journal.jsonl");
  const queueFile = path.join(store.home, "review", "queue.jsonl");
  const completed = new Set(readJsonl(journalFile)
    .map((entry) => entry.pair_id)
    .filter((value) => typeof value === "string"));
  const queuedPairs = new Set(readJsonl(queueFile)
    .map((entry) => entry.pair_id)
    .filter((value) => typeof value === "string"));
  let applied = 0;
  let queued = 0;
  let skipped = 0;

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
        && confidence >= 0.9
        && (judgment.newer === "a" || judgment.newer === "b")) {
        const newFact = judgment.newer === "a" ? a : b;
        const oldFact = judgment.newer === "a" ? b : a;
        store.transition(oldFact.id, STATUS.INVALIDATED, {
          t_invalid: newFact.t_valid,
        }, "daemon");
        applied += 1;
        outcome = "applied";
      } else if ((judgment.verdict === "duplicate" || judgment.verdict === "contradiction")
        && confidence >= 0.6
        && (confidence < 0.9
          // 고신뢰 모순인데 방향(newer) 미확정 — 자동 적용 대신 사람 리뷰로 (오병합 비대칭 원칙)
          || (judgment.verdict === "contradiction" && judgment.newer !== "a" && judgment.newer !== "b"))) {
        if (!queuedPairs.has(judgment.pair_id)) {
          appendJsonl(queueFile, {
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
    appendJsonl(journalFile, {
      kind: "judgment",
      pair_id: judgment?.pair_id,
      verdict: judgment?.verdict,
      confidence: judgment?.confidence,
      outcome,
      at: new Date().toISOString(),
    });
    if (typeof judgment?.pair_id === "string") completed.add(judgment.pair_id);
  }

  return { applied, queued, skipped };
}
