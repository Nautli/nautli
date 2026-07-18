import { randomUUID } from "node:crypto";
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

// deferred 복원 시 surfaced_at을 벗겨야 복원 카드가 노출 캡 후보줄로 되돌아간다
// (유지하면 이미 노출된 3장 위에 얹혀 하루 캡을 뚫는다).
function restoreDueDeferred(entry, today) {
  if (entry.status !== "deferred"
    || typeof entry.deferred_until !== "string"
    || entry.deferred_until > today) {
    return null;
  }
  const { surfaced_at: _surfaced, ...rest } = entry;
  return { ...rest, status: "pending" };
}

export function listCards(home) {
  return withReviewLock(home, () => {
    const entries = readQueue(home);
    const today = new Date().toLocaleDateString("sv-SE");
    let changed = false;
    const restored = entries.map((entry) => {
      const revived = restoreDueDeferred(entry, today);
      if (revived) {
        changed = true;
        return revived;
      }
      return entry;
    });
    if (changed) writeQueue(home, restored);
    return restored.filter((entry) => entry.status === "pending");
  });
}

// 유저 노출 경로 전용이며 하루 cap개만 새로 노출한다는 불변식을 지킨다.
export function listSurfacedCards(home, { cap = 3, now = new Date() } = {}) {
  return withReviewLock(home, () => {
    const entries = readQueue(home);
    const today = now.toLocaleDateString("sv-SE");
    let changed = false;
    const restored = entries.map((entry) => {
      const revived = restoreDueDeferred(entry, today);
      if (revived) {
        changed = true;
        return revived;
      }
      return entry;
    });
    const pending = restored.filter((entry) => entry.status === "pending");
    // surfaced_at은 UTC ISO라 로컬 날짜로 환산해 비교한다 — 문자열 startsWith 비교는
    // UTC 오프셋 구간(예: KST 오전)에서 당일 노출을 놓쳐 캡이 재개방된다.
    const surfacedToday = restored.filter((entry) => (
      entry.surfaced_at
      && new Date(entry.surfaced_at).toLocaleDateString("sv-SE") === today
    )).length;
    const visible = pending.filter((entry) => entry.surfaced_at);
    const slots = Math.max(0, Math.min(cap - visible.length, cap - surfacedToday));
    const compareCards = (a, b) => {
      const typeOrder = Number(a.type === "capture") - Number(b.type === "capture");
      if (typeOrder !== 0) return typeOrder;
      const atOrder = (a.at || "").localeCompare(b.at || "");
      if (atOrder !== 0) return atOrder;
      return a.pair_id.localeCompare(b.pair_id);
    };
    const surfacedAt = now.toISOString();
    const candidates = pending.filter((entry) => !entry.surfaced_at).sort(compareCards);
    for (const entry of candidates.slice(0, slots)) {
      entry.surfaced_at = surfacedAt;
      changed = true;
    }
    if (changed) writeQueue(home, restored);
    const cards = pending.filter((entry) => entry.surfaced_at).sort(compareCards);
    return { cards, backlog: pending.length - cards.length };
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

// --- Undo ledger ---

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

function appendUndoEntry(home, entry) {
  const file = undoLedgerFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
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

export function recordAutoApply(home, {
  undo_id,
  pair_id,
  action,
  verdict,
  confidence,
  scope,
  model,
  before_state,
  fact_ids,
  fact_id,
  claim_a,
  claim_b,
  claim,
  type,
  newer,
}) {
  const entry = {
    undo_id: undo_id || randomUUID(),
    pair_id,
    action,
    verdict: verdict ?? null,
    confidence: confidence ?? null,
    scope: scope ?? null,
    model: model ?? null,
    type: type ?? "pair",
    before_state: before_state ?? [],
    fact_ids: fact_ids ?? [],
    ...(fact_id ? { fact_id } : {}),
    ...(claim_a ? { claim_a } : {}),
    ...(claim_b ? { claim_b } : {}),
    ...(claim ? { claim } : {}),
    // shadow 항목의 승자 방향 보존 — 마이크로 컨펌이 나중에 판정 방향을 알아야 적용 가능
    ...(newer === "a" || newer === "b" ? { newer } : {}),
    applied_at: new Date().toISOString(),
    undone: false,
  };
  appendUndoEntry(home, entry);
  return entry;
}

// 마이크로 컨펌: shadow 항목을 유저가 열람 중 명시 승인하면 그 자리에서 적용한다 (pull형 — 밀지 않음).
export function confirmShadowApply(store, home, undoId) {
  return withReviewLock(home, () => {
    const ledger = readUndoLedger(home);
    const index = ledger.findIndex((e) => e.undo_id === undoId);
    if (index < 0) throw codedError(ERR.E_NOT_FOUND);
    const entry = ledger[index];
    if (entry.undone) return { ok: false, reason: "already_undone" };
    if (entry.action !== "shadow") return { ok: false, reason: "not_shadow" };
    const now = new Date().toISOString();

    if (entry.type === "capture") {
      if (!entry.claim) return { ok: false, reason: "no_claim" };
      const result = remember(store, {
        claim: entry.claim,
        scope: entry.scope ?? undefined,
        confidence: entry.confidence ?? undefined,
        source: "capture",
      }, {});
      if (result.status !== "added" && result.status !== "duplicate") {
        return { ok: false, reason: result.status };
      }
      // duplicate면 result.id는 기존 active fact — fact_id로 기록하면 undo가 남의 fact를 archive한다
      ledger[index] = {
        ...entry,
        action: "remember",
        ...(result.status === "added" && result.id ? { fact_id: result.id } : {}),
        confirmed_at: now,
        confirmed_by: "user",
      };
      writeUndoLedger(home, ledger);
      store.appendEvent({ ev: "shadow.confirmed", undo_id: undoId, action: "remember", at: now });
      return { ok: true, action: "remember" };
    }

    const ids = Array.isArray(entry.fact_ids) ? entry.fact_ids : [];
    const a = ids.length === 2 ? store.getFact(ids[0]) : null;
    const b = ids.length === 2 ? store.getFact(ids[1]) : null;
    if (a?.status !== STATUS.ACTIVE || b?.status !== STATUS.ACTIVE) {
      return { ok: false, reason: "facts_not_active" };
    }
    // 명시됐는데 a/b가 아닌 오염값은 '부재'가 아니라 방향 불명 — 폴백 병합 금지
    if (entry.newer != null && entry.newer !== "a" && entry.newer !== "b") {
      return { ok: false, reason: "no_direction" };
    }
    const newerFact = entry.newer === "a" ? a : entry.newer === "b" ? b : null;
    let winner;
    let loser;
    if (newerFact) {
      winner = newerFact;
      loser = winner.id === a.id ? b : a;
    } else if (entry.verdict === "duplicate") {
      // duplicate는 t_valid 폴백 허용, contradiction은 방향 없이 적용 금지
      [loser, winner] = a.t_valid <= b.t_valid ? [a, b] : [b, a];
    } else {
      return { ok: false, reason: "no_direction" };
    }
    const beforeState = [
      { id: loser.id, status: loser.status, claim: loser.claim },
      { id: winner.id, status: winner.status, claim: winner.claim },
    ];
    let action;
    if (entry.verdict === "duplicate") {
      store.transition(loser.id, STATUS.SUPERSEDED, { superseded_by: winner.id }, "daemon");
      action = "merge";
    } else if (entry.verdict === "contradiction") {
      store.transition(loser.id, STATUS.INVALIDATED, { t_invalid: winner.t_valid }, "daemon");
      action = entry.newer === "a" ? "a_wins" : "b_wins";
    } else {
      return { ok: false, reason: "unsupported_verdict" };
    }
    ledger[index] = {
      ...entry,
      action,
      before_state: beforeState,
      confirmed_at: now,
      confirmed_by: "user",
    };
    writeUndoLedger(home, ledger);
    store.appendEvent({ ev: "shadow.confirmed", undo_id: undoId, action, at: now });
    return { ok: true, action };
  });
}

export function listUndoLedger(home) {
  return readUndoLedger(home);
}

export function undoAutoApply(store, home, undoId) {
  return withReviewLock(home, () => {
    const ledger = readUndoLedger(home);
    const index = ledger.findIndex((e) => e.undo_id === undoId);
    if (index < 0) throw codedError(ERR.E_NOT_FOUND);
    const entry = ledger[index];
    if (entry.undone) return { ok: false, reason: "already_undone" };

    // Reverse the action
    if (entry.action === "merge" || entry.action === "newer_wins"
      || entry.action === "a_wins" || entry.action === "b_wins") {
      // Restore facts that were SUPERSEDED or INVALIDATED
      for (const snap of entry.before_state) {
        const current = store.getFact(snap.id);
        if (!current) continue;
        if (current.status === STATUS.SUPERSEDED || current.status === STATUS.INVALIDATED) {
          store.transition(snap.id, STATUS.ACTIVE, {}, "undo");
        }
      }
    } else if (entry.action === "remember" && entry.fact_id) {
      // Delete the auto-remembered fact
      const fact = store.getFact(entry.fact_id);
      if (fact && fact.status === STATUS.ACTIVE) {
        store.transition(entry.fact_id, STATUS.ARCHIVED, {}, "daemon");
      }
    }

    ledger[index] = { ...entry, undone: true, undone_at: new Date().toISOString() };
    writeUndoLedger(home, ledger);
    store.appendEvent({
      ev: "undo.applied",
      undo_id: undoId,
      pair_id: entry.pair_id,
      action: entry.action,
      at: new Date().toISOString(),
    });
    return { ok: true, undo_id: undoId, reversed_action: entry.action };
  });
}

export function migratePendingToAutoApply(store, home) {
  return withReviewLock(home, () => {
    const entries = readQueue(home);
    let migrated = 0;
    const updated = entries.map((entry) => {
      if (entry.status !== "pending") return entry;

      if (entry.type === "capture") {
        // Capture cards with recommend=remember → auto-apply
        if (entry.recommend === "remember") {
          try {
            const result = remember(store, {
              claim: entry.claim,
              scope: entry.scope,
              confidence: entry.confidence,
              source: "capture",
              provenance: {
                session_id: entry.session_id,
                project: entry.project,
              },
            }, {});
            if (result.status === "added" || result.status === "duplicate") {
              recordAutoApply(home, {
                pair_id: entry.pair_id,
                action: "remember",
                verdict: null,
                confidence: entry.confidence ?? null,
                scope: entry.scope ?? null,
                model: null,
                before_state: [],
                fact_ids: [],
                // duplicate면 result.id는 기존 fact — undo가 그걸 archive하지 않게 added일 때만 기록
                fact_id: result.status === "added" ? (result.id ?? null) : null,
                claim: entry.claim,
                type: "capture",
              });
              migrated += 1;
              return {
                ...entry,
                status: "answered",
                action: "remember",
                handled_at: new Date().toISOString(),
                answered_by: "migration",
                ...(result.id ? { fact_id: result.id } : {}),
              };
            }
          } catch {
            // fail-open: leave as pending
          }
        }
        // Other capture cards → shadow
        recordAutoApply(home, {
          pair_id: entry.pair_id,
          action: "shadow",
          verdict: null,
          confidence: entry.confidence ?? null,
          scope: entry.scope ?? null,
          model: null,
          before_state: [],
          fact_ids: [],
          claim: entry.claim,
          type: "capture",
        });
        migrated += 1;
        return {
          ...entry,
          status: "routed",
          route: "shadow",
          handled_at: new Date().toISOString(),
          answered_by: "migration",
        };
      }

      // Pair cards
      const ids = typeof entry.pair_id === "string" ? entry.pair_id.split(":") : [];
      const a = ids.length === 2 ? store.getFact(ids[0]) : null;
      const b = ids.length === 2 ? store.getFact(ids[1]) : null;
      const confidence = Number(entry.confidence);

      // T1: duplicate, conf≥0.9, scope≠person(양쪽), human 판정(crux_plain) 아님, newer 오염값 아님 → auto-merge
      if (entry.verdict === "duplicate" && confidence >= 0.9
        && a?.status === STATUS.ACTIVE && b?.status === STATUS.ACTIVE
        && a?.scope !== "person" && b?.scope !== "person"
        && !entry.crux_plain
        && (entry.newer == null || entry.newer === "a" || entry.newer === "b")) {
        // 승자 방향은 카드의 newer 필드가 정본, t_valid 비교는 폴백 (GO 조건 ③)
        const newerFromEntry = entry.newer === "a" ? a : entry.newer === "b" ? b : null;
        const [older, newer] = newerFromEntry
          ? (newerFromEntry.id === a.id ? [b, a] : [a, b])
          : (a.t_valid <= b.t_valid ? [a, b] : [b, a]);
        const beforeState = [
          { id: older.id, status: older.status, claim: older.claim },
          { id: newer.id, status: newer.status, claim: newer.claim },
        ];
        store.transition(older.id, STATUS.SUPERSEDED, {
          superseded_by: newer.id,
        }, "daemon");
        recordAutoApply(home, {
          pair_id: entry.pair_id,
          action: "merge",
          verdict: entry.verdict,
          confidence,
          scope: a.scope,
          model: null,
          before_state: beforeState,
          fact_ids: [a.id, b.id],
          claim_a: a.claim,
          claim_b: b.claim,
          type: "pair",
        });
        migrated += 1;
        return {
          ...entry,
          status: "answered",
          action: "merge",
          handled_at: new Date().toISOString(),
          answered_by: "migration",
        };
      }

      // Everything else → shadow
      recordAutoApply(home, {
        pair_id: entry.pair_id,
        action: "shadow",
        verdict: entry.verdict ?? null,
        confidence: confidence || null,
        scope: a?.scope ?? null,
        model: null,
        before_state: [],
        fact_ids: ids,
        newer: entry.newer,
        claim_a: entry.claims?.a ?? a?.claim,
        claim_b: entry.claims?.b ?? b?.claim,
        type: "pair",
      });
      migrated += 1;
      return {
        ...entry,
        status: "routed",
        route: "shadow",
        handled_at: new Date().toISOString(),
        answered_by: "migration",
      };
    });

    if (migrated > 0) writeQueue(home, updated);
    return { migrated, total: entries.filter((e) => e.status === "pending").length };
  });
}

export function undoStats(home) {
  const ledger = readUndoLedger(home);
  const total = ledger.length;
  const undone = ledger.filter((e) => e.undone).length;
  return { total, undone, undo_rate: total > 0 ? undone / total : 0 };
}
