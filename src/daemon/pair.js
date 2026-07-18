import fs from "node:fs";
import path from "node:path";
import { STATUS } from "../core/schema.js";

function completedPairs(home) {
  const file = path.join(home, "daemon", "journal.jsonl");
  if (!fs.existsSync(file)) return new Set();

  const completed = new Set();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      // judgment_failed(일시 오류로 판정 못 한 쌍)는 다음 소화 때 다시 쌍으로 올라와야 한다
      if (entry.kind === "judgment_failed") continue;
      if (typeof entry.pair_id === "string") completed.add(entry.pair_id);
    } catch {
      // A partial trailing journal line is not a completed judgment.
    }
  }
  return completed;
}

function pairId(left, right) {
  return left.id < right.id
    ? `${left.id}:${right.id}`
    : `${right.id}:${left.id}`;
}

function bigrams(value) {
  const chars = Array.from(String(value).toLowerCase());
  const counts = new Map();
  if (chars.length < 2) {
    if (chars.length === 1) counts.set(chars[0], 1);
    return counts;
  }
  for (let index = 0; index < chars.length - 1; index += 1) {
    const gram = `${chars[index]}${chars[index + 1]}`;
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function cosine(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const count of a.values()) normA += count * count;
  for (const count of b.values()) normB += count * count;
  for (const [gram, count] of a) dot += count * (b.get(gram) ?? 0);
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function findPairs(store, { simFloor = 0.25, topK = 5, scope, subject } = {}) {
  const queryOpts = { status: STATUS.ACTIVE };
  if (scope) queryOpts.scope = scope;
  if (subject) queryOpts.subject = subject;
  const active = store.query(queryOpts);
  const byId = new Map(active.map((fact) => [fact.id, fact]));
  const completed = completedPairs(store.home);
  const found = new Map();
  const candidateLimit = Math.max(1, Math.trunc(topK)) + 1;

  for (const fact of active) {
    const matches = store.searchFts(fact.claim, {
      scope: fact.scope,
      limit: candidateLimit,
    });
    let accepted = 0;
    for (const match of matches) {
      if (match.id === fact.id) continue;
      const candidate = byId.get(match.id);
      if (!candidate || candidate.scope !== fact.scope) continue;
      if (accepted >= topK) break;
      accepted += 1;

      const id = pairId(fact, candidate);
      if (completed.has(id) || found.has(id)) continue;
      const subjectBonus = fact.subject !== "" && fact.subject === candidate.subject ? 0.08 : 0;
      const sim = Math.min(1, cosine(fact.claim, candidate.claim) + subjectBonus);
      if (sim < simFloor) continue;

      const [a, b] = fact.id < candidate.id
        ? [fact, candidate]
        : [candidate, fact];
      found.set(id, { a, b, sim });
    }
  }

  return [...found.values()].sort((left, right) => {
    const leftId = pairId(left.a, left.b);
    const rightId = pairId(right.a, right.b);
    return leftId.localeCompare(rightId);
  });
}
