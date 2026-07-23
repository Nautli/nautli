import {
  ERR,
  STATUS,
  claimHash,
  newId,
  validScope,
} from "./schema.js";
import { isInjectionLike } from "./policy.js";
import { touchSpool } from "./spool.js";

const FACT_TYPES = new Set(["episodic", "semantic", "procedural"]);

// TASK-024: Both CLI and MCP reach remember() through this parser, so accepted
// validity instants have one validation and storage path.
export function normalizeValidTime(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const isCalendarDate = (year, month, day) => {
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return parsed.getUTCFullYear() === Number(year)
      && parsed.getUTCMonth() + 1 === Number(month)
      && parsed.getUTCDate() === Number(day);
  };
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return isCalendarDate(year, month, day) ? value : null;
  }

  const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!dateTime) {
    return null;
  }
  const [, year, month, day, hour, minute, second = "0", zone] = dateTime;
  const zoneMinutes = zone === "Z" ? 0 : Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6));
  if (!isCalendarDate(year, month, day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || zoneMinutes > 23 * 60 + 59) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function rejected(reason) {
  return { status: "rejected", reason };
}

// TASK-003: degraded (not rejected) — the fact is durably logged but the index write failed.
// status stays "added" so CLI/MCP/dashboard treat it as a creation; degraded/warning/ev_id
// let consumers surface the failure (dashboard maps this to 202).
function degradedAdded(id, ev_id) {
  return { id, status: "added", degraded: true, warning: ERR.W_INDEX_DEGRADED, ev_id };
}

function validOptionalInputs(input) {
  if (input.type !== undefined && !FACT_TYPES.has(input.type)) return false;
  if (input.subject !== undefined && typeof input.subject !== "string") return false;
  if (input.t_valid !== undefined && normalizeValidTime(input.t_valid) === null) return false;
  if (input.confidence !== undefined
    && (typeof input.confidence !== "number"
      || !Number.isFinite(input.confidence)
      || input.confidence < 0
      || input.confidence > 1)) return false;
  if (input.supersedes !== undefined && typeof input.supersedes !== "string") return false;
  if (input.source !== undefined && (typeof input.source !== "string" || input.source.trim() === "")) return false;
  if (input.provenance !== undefined
    && (!input.provenance
      || typeof input.provenance !== "object"
      || Array.isArray(input.provenance)
      || Object.values(input.provenance).some((value) => typeof value !== "string"))) return false;
  return true;
}

function makeFact(input, scope, claim) {
  // INVARIANT: claim text is DATA — never interpreted as instructions.
  // Injection-like claims are stored with a provenance flag for audit only.
  const injectionFlagged = isInjectionLike(claim);
  return {
    id: newId(),
    type: input.type ?? "episodic",
    scope,
    subject: input.subject ?? "",
    claim,
    confidence: input.confidence ?? 0.7,
    provenance: {
      ...(input.provenance ?? {}),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(injectionFlagged ? { injection_flagged: "true" } : {}),
    },
    t_valid: input.t_valid === undefined
      ? new Date().toLocaleDateString("sv-SE")
      : normalizeValidTime(input.t_valid),
    t_invalid: null,
    t_expired: null,
    superseded_by: null,
    status: STATUS.ACTIVE,
    claim_hash: claimHash(claim),
  };
}

export function remember(store, input, config) {
  if (!input || typeof input.claim !== "string" || input.claim.trim() === "") {
    return rejected(ERR.E_INVALID_INPUT);
  }

  if (input.claim.length > 280) return rejected(ERR.E_CLAIM_TOO_LONG);

  if (/\n\s*(?:-|\*|1\.)/.test(input.claim) || input.claim.split(/;\s+/).length >= 3) {
    return rejected(ERR.E_MULTI_FACT);
  }

  const scope = input.scope ?? config?.default_scope;
  if (!validScope(scope)) return rejected(ERR.E_UNKNOWN_SCOPE);
  if (!validOptionalInputs(input)) return rejected(ERR.E_INVALID_INPUT);

  const claim = input.claim.trim();

  if (input.supersedes !== undefined) {
    const oldFact = store.getFact(input.supersedes);
    // active가 아닌 대상(stale id, 이미 대체/무효화됨)은 throw 대신 거부 반환 — remember()는 예외를 안 던진다
    if (!oldFact || oldFact.status !== STATUS.ACTIVE) return rejected(ERR.E_NOT_FOUND);
    const fact = makeFact(input, scope, claim);
    // TASK-003: either the add or the supersede transition may hit an index-apply failure;
    // surface the degraded warning (event is durably logged) instead of a false success.
    const added = store.addFact(fact);
    // TASK-104: 유저의 remember 경유 supersede — 정해진 reason, policy는 "n/a"(직접 경로).
    const transitioned = store.transition(oldFact.id, STATUS.SUPERSEDED, {
      superseded_by: fact.id,
      t_invalid: fact.t_valid,
    }, "client", { reason: "user supersedes via remember", policy_version: "n/a" });
    touchSpool(store.home);
    return added?.index_degraded || transitioned?.index_degraded
      ? degradedAdded(fact.id, added?.index_degraded ? added.ev_id : transitioned.ev_id)
      : { id: fact.id, status: "added" };
  }

  const hash = claimHash(claim);
  const duplicate = store.byHash(hash);
  if (duplicate?.status === STATUS.ACTIVE) {
    store.appendEvent({
      type: "remember",
      result: "duplicate",
      fact_id: duplicate.id,
      claim,
      source: input.source ?? "core",
    });
    return { id: duplicate.id, status: "duplicate", reason: ERR.W_DUPLICATE };
  }

  const fact = makeFact(input, scope, claim);
  // TASK-003: index write may have failed after the event was durably logged — return a
  // degraded shape rather than a false 201/success, without provoking a duplicate-creating retry.
  const added = store.addFact(fact);
  touchSpool(store.home);
  return added?.index_degraded
    ? degradedAdded(fact.id, added.ev_id)
    : { id: fact.id, status: "added" };
}
