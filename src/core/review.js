import fs from "node:fs";
import path from "node:path";
import { remember } from "./gate.js";
import { withReviewLock } from "./review-lock.js";
import { ERR, STATUS } from "./schema.js";

const ACTIONS = new Set([
  "merge",
  "keep_separate",
  "defer",
  "newer_wins",
  "older_wins",
  "a_wins",
  "b_wins",
  "both_valid",
  "unknown",
  "other",
  "report_issue",
]);
const CAPTURE_ACTIONS = new Set(["remember", "dismissed", "unknown", "deferred"]);

function codedError(code, message = code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function queueFile(home) {
  return path.join(home, "review", "queue.jsonl");
}

function readQueue(home) {
  const file = queueFile(home);
  if (!fs.existsSync(file)) return [];
  const entries = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      if (!entry || typeof entry !== "object" || typeof entry.pair_id !== "string") {
        throw new Error("invalid review entry");
      }
      entries.push(entry);
    } catch (error) {
      throw codedError(ERR.E_INVALID_INPUT, `Invalid review queue at line ${index + 1}`, error);
    }
  }
  return entries;
}

function writeQueue(home, entries) {
  const file = queueFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const data = entries.length === 0 ? "" : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function unorderedPairKey(pairId) {
  const ids = typeof pairId === "string" ? pairId.split(":") : [];
  return ids.length === 2 ? ids.sort().join(":") : pairId;
}

export function appendCards(home, entries) {
  return withReviewLock(home, () => {
    const queue = readQueue(home);
    const queuedPairs = new Set(queue.map((entry) => unorderedPairKey(entry.pair_id)));
    let added = 0;
    for (const entry of entries) {
      const key = unorderedPairKey(entry?.pair_id);
      if (typeof entry?.pair_id !== "string" || queuedPairs.has(key)) continue;
      queue.push(entry);
      queuedPairs.add(key);
      added += 1;
    }
    if (added > 0) writeQueue(home, queue);
    return added;
  });
}

function pairFacts(store, pairId) {
  const ids = typeof pairId === "string" ? pairId.split(":") : [];
  if (ids.length !== 2) throw codedError(ERR.E_INVALID_INPUT);
  const facts = ids.map((id) => store.getFact(id));
  if (facts.some((fact) => !fact)) throw codedError(ERR.E_NOT_FOUND);
  return facts;
}

function orderedByAge(a, b) {
  const aKey = `${a.t_valid}\u0000${a.t_created}\u0000${a.id}`;
  const bKey = `${b.t_valid}\u0000${b.t_created}\u0000${b.id}`;
  return aKey <= bKey ? [a, b] : [b, a];
}

export function listCards(home) {
  return withReviewLock(home, () => {
    const entries = readQueue(home);
    const today = new Date().toLocaleDateString("sv-SE");
    let changed = false;
    const restored = entries.map((entry) => {
      if (entry.status === "deferred"
        && typeof entry.deferred_until === "string"
        && entry.deferred_until <= today) {
        changed = true;
        return { ...entry, status: "pending" };
      }
      return entry;
    });
    if (changed) writeQueue(home, restored);
    return restored.filter((entry) => entry.status === "pending");
  });
}

export function applyCard(store, home, pairId, action, extraText) {
  if (!ACTIONS.has(action)) throw codedError(ERR.E_INVALID_INPUT);
  return withReviewLock(home, () => {
    const entries = readQueue(home);
    const index = entries.findIndex((entry) => entry.pair_id === pairId);
    if (index < 0) throw codedError(ERR.E_NOT_FOUND);
    if (entries[index].status !== "pending") return { ok: false, reason: "already_handled" };

    const [a, b] = pairFacts(store, pairId);
    const [chronologicalOlder, chronologicalNewer] = orderedByAge(a, b);
    const newer = entries[index].newer === "a" ? a
      : entries[index].newer === "b" ? b
        : chronologicalNewer;
    const older = newer.id === a.id ? b : a;
    let status = "answered";
    let deferredUntil;

    if (action === "keep_separate" || action === "both_valid" || action === "unknown") {
      status = "dismissed";
    }
    if (action === "report_issue") {
      // 엣지케이스 신고: 기억은 건드리지 않고 카드만 닫되, 사유를 영속 기록해
      // 판정 품질 개선의 원료로 쓴다 (유저 요청 2026-07-16 "왜 뜨는지 모르겠다").
      if (typeof extraText !== "string" || extraText.trim() === "") throw codedError(ERR.E_INVALID_INPUT);
      status = "dismissed";
      fs.appendFileSync(
        path.join(home, "review", "issue-reports.jsonl"),
        `${JSON.stringify({ pair_id: pairId, text: extraText.trim(), verdict: entries[index].verdict, at: new Date().toISOString() })}\n`,
        "utf8",
      );
    }
    if (action === "defer") {
      status = "deferred";
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      deferredUntil = tomorrow.toLocaleDateString("sv-SE");
    }
    if (action === "other") {
      if (typeof extraText !== "string" || extraText.trim() === "") throw codedError(ERR.E_INVALID_INPUT);
      if (a.scope !== b.scope) throw codedError(ERR.E_INVALID_INPUT, "Review pair scopes differ");
    }

    let remembered;
    if (action === "merge"
      && chronologicalOlder.status === STATUS.ACTIVE
      && chronologicalNewer.status === STATUS.ACTIVE) {
      store.transition(chronologicalOlder.id, STATUS.SUPERSEDED, {
        superseded_by: chronologicalNewer.id,
        t_invalid: chronologicalNewer.t_valid,
      }, "daemon");
    } else if (action === "newer_wins" || action === "older_wins") {
      const loser = action === "newer_wins" ? older : newer;
      const winner = action === "newer_wins" ? newer : older;
      if (loser.status === STATUS.ACTIVE) {
        store.transition(loser.id, STATUS.INVALIDATED, { t_invalid: winner.t_valid }, "daemon");
      }
    } else if (action === "a_wins" || action === "b_wins") {
      const winner = action === "a_wins" ? a : b;
      const loser = action === "a_wins" ? b : a;
      if (loser.status === STATUS.ACTIVE) {
        store.transition(loser.id, STATUS.INVALIDATED, { t_invalid: winner.t_valid }, "daemon");
      }
    } else if (action === "other") {
      remembered = remember(store, {
        claim: extraText.trim(),
        scope: a.scope,
        subject: a.subject === b.subject ? a.subject : "",
        confidence: 0.9,
        source: "review-card",
      }, { default_scope: a.scope });
      if (remembered.status !== "added") throw codedError(remembered.reason);
    }

    entries[index] = {
      ...entries[index],
      status,
      action,
      handled_at: new Date().toISOString(),
      ...(deferredUntil ? { deferred_until: deferredUntil } : {}),
    };
    writeQueue(home, entries);

    return { ok: true, status, action, remembered };
  });
}

export function applyCaptureCard(store, home, pairId, action, config = {}, options = {}) {
  if (!CAPTURE_ACTIONS.has(action)) throw codedError(ERR.E_INVALID_INPUT);
  return withReviewLock(home, () => {
    const entries = readQueue(home);
    const index = entries.findIndex((entry) => entry.pair_id === pairId);
    if (index < 0 || entries[index].type !== "capture") {
      throw codedError(ERR.E_NOT_FOUND);
    }
    const card = entries[index];
    if (card.status !== "pending") return { ok: false, reason: "already_handled" };

    let remembered;
    let status = action;
    let deferredUntil;
    if (action === "remember") {
      remembered = remember(store, {
        claim: card.claim,
        scope: card.scope,
        confidence: card.confidence,
        source: "capture",
        provenance: {
          session_id: card.session_id,
          project: card.project,
        },
      }, config);
      if (remembered.status !== "added" && remembered.status !== "duplicate") {
        throw codedError(remembered.reason);
      }
      status = "answered";
    } else if (action === "deferred") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      deferredUntil = tomorrow.toLocaleDateString("sv-SE");
    }

    const handledAt = new Date().toISOString();
    const createdTime = Date.parse(card.at);
    const handledTime = Date.parse(handledAt);
    const latency = Number.isFinite(createdTime)
      && Number.isFinite(handledTime)
      && handledTime >= createdTime
      ? handledTime - createdTime
      : null;

    entries[index] = {
      ...card,
      status,
      action,
      handled_at: handledAt,
      ...(typeof options.actor === "string" && options.actor !== ""
        ? { answered_by: options.actor }
        : {}),
      ...(remembered?.id ? { fact_id: remembered.id } : {}),
      ...(deferredUntil ? { deferred_until: deferredUntil } : {}),
    };
    writeQueue(home, entries);
    store.appendEvent({
      ev: "capture.decided",
      pair_id: pairId,
      action,
      ...(typeof options.actor === "string" && options.actor !== ""
        ? { answered_by: options.actor }
        : {}),
      confidence: card.confidence ?? null,
      latency_ms: latency,
      at: handledAt,
    });
    return { ok: true, status, action, remembered };
  });
}
