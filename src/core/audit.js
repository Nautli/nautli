// TASK-105
import fs from "node:fs";
import path from "node:path";
import { ERR, STATUS, validScope } from "./schema.js";
import { readLogicalEvents } from "./store.js";

// TASK-105
const EVENT_STATUS = Object.freeze({
  "fact.superseded": STATUS.SUPERSEDED,
  "fact.invalidated": STATUS.INVALIDATED,
  "fact.archived": STATUS.ARCHIVED,
  "fact.restored": STATUS.ACTIVE,
});

// TASK-105
function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// TASK-105
function assertAuditTime(at) {
  if (typeof at !== "string" || at.trim() === "" || !Number.isFinite(Date.parse(at))) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
}

// TASK-105
function assertAuditScope(scope) {
  if (typeof scope !== "string" || !validScope(scope)) throw codedError(ERR.E_INVALID_INPUT);
}

// TASK-105
function assertFactId(factId) {
  if (typeof factId !== "string" || factId.trim() === "") throw codedError(ERR.E_INVALID_INPUT);
}

// TASK-105
function assertValidJsonLines(home) {
  const directory = path.join(home, "events");
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}\.jsonl$/u.test(file))
    .sort()) {
    for (const line of fs.readFileSync(path.join(directory, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        JSON.parse(line);
      } catch {
        throw codedError(ERR.E_INVALID_INPUT);
      }
    }
  }
}

// TASK-105
function logicalAuditEvents(home) {
  assertValidJsonLines(home);
  return readLogicalEvents(home);
}

// TASK-105
function factState(events) {
  const facts = new Map();
  for (const event of events) {
    if (event?.ev === "fact.added" && typeof event.fact?.id === "string" && !facts.has(event.fact.id)) {
      facts.set(event.fact.id, { ...event.fact, status: event.fact.status ?? STATUS.ACTIVE });
      continue;
    }
    if (event?.ev === "fact.purged" && Array.isArray(event.fact_ids)) {
      for (const factId of event.fact_ids) {
        const fact = facts.get(factId);
        if (fact) fact.status = "purged";
      }
      continue;
    }
    const status = EVENT_STATUS[event?.ev];
    const fact = typeof event?.id === "string" ? facts.get(event.id) : null;
    if (!status || !fact) continue;
    if (event.patch && typeof event.patch === "object" && !Array.isArray(event.patch)) {
      Object.assign(fact, event.patch);
    }
    fact.status = status;
  }
  return facts;
}

// TASK-105
function deliveryEntries(events, factId) {
  return events
    .filter((event) => event?.type === "recall" && Array.isArray(event.hits) && event.hits.includes(factId))
    .map((event) => ({
      at: typeof event.at === "string" ? event.at : null,
      tool: typeof event.tool === "string" ? event.tool : null,
      session_id: typeof event.session_id === "string" ? event.session_id : null,
      query: typeof event.query === "string" ? event.query : null,
      scope: typeof event.scope === "string" ? event.scope : null,
    }));
}

// TASK-105
function predecessorChain(events, factId) {
  const predecessorBySuccessor = new Map();
  for (const event of events) {
    const successor = event?.ev === "fact.superseded" && typeof event.id === "string"
      && typeof event.patch?.superseded_by === "string"
      ? event.patch.superseded_by
      : null;
    if (successor && !predecessorBySuccessor.has(successor)) {
      predecessorBySuccessor.set(successor, event.id);
    }
  }
  const chain = [factId];
  const seen = new Set(chain);
  while (predecessorBySuccessor.has(chain[0])) {
    const predecessor = predecessorBySuccessor.get(chain[0]);
    if (seen.has(predecessor)) break;
    seen.add(predecessor);
    chain.unshift(predecessor);
  }
  return chain;
}

// TASK-105
function verdictEvent(event) {
  const isAdded = event.ev === "fact.added";
  const isCapture = event.ev === "capture.decided";
  const isTransition = event.ev === "fact.superseded" || event.ev === "fact.invalidated";
  const isUndo = event.ev === "undo.applied";
  return {
    kind: isAdded ? "added" : isTransition ? event.ev.slice("fact.".length) : event.ev,
    at: typeof event.at === "string" ? event.at : null,
    source: isAdded && typeof event.source === "string" ? event.source : null,
    action: (isCapture || isUndo) && typeof event.action === "string" ? event.action : null,
    confidence: isCapture && Number.isFinite(event.confidence) ? event.confidence : null,
    actor: (isCapture || isTransition || isUndo) && typeof event.actor === "string" ? event.actor : null,
    reason: (isCapture || isTransition || isUndo) && typeof event.reason === "string" ? event.reason : null,
    policy_version: (isCapture || isTransition || isUndo) && typeof event.policy_version === "string"
      ? event.policy_version
      : null,
    by: event.ev === "fact.superseded" && typeof event.patch?.superseded_by === "string"
      ? event.patch.superseded_by
      : null,
  };
}

// TASK-105
function isVerdictEventFor(event, factId) {
  if (event?.ev === "fact.added") return event.fact?.id === factId;
  if (event?.ev === "capture.decided") return event.fact_id === factId;
  if (event?.ev === "fact.superseded" || event?.ev === "fact.invalidated") return event.id === factId;
  return event?.ev === "undo.applied"
    && (event.fact_id === factId || event.id === factId
      || (Array.isArray(event.fact_ids) && event.fact_ids.includes(factId)));
}

// TASK-105
export function auditAsOf(home, at, scope) {
  assertAuditTime(at);
  assertAuditScope(scope);
  const facts = factState(logicalAuditEvents(home));
  const factIds = [...facts.values()]
    .filter((fact) => fact.scope === scope
      && typeof fact.t_valid === "string" && fact.t_valid <= at
      && (fact.t_invalid === null || fact.t_invalid > at)
      && fact.status !== "purged")
    .map((fact) => fact.id)
    .sort();
  return { at, scope, fact_ids: factIds };
}

// TASK-105
export function auditDelivery(home, factId, { chain = false } = {}) {
  assertFactId(factId);
  const events = logicalAuditEvents(home);
  const facts = factState(events);
  if (!facts.has(factId)) throw codedError(ERR.E_NOT_FOUND);
  const result = { fact_id: factId, deliveries: deliveryEntries(events, factId) };
  if (chain) {
    result.versions = predecessorChain(events, factId).map((versionId) => ({
      fact_id: versionId,
      deliveries: deliveryEntries(events, versionId),
    }));
  }
  return result;
}

// TASK-105
export function auditVerdict(home, factId) {
  assertFactId(factId);
  const events = logicalAuditEvents(home);
  const facts = factState(events);
  const fact = facts.get(factId);
  if (!fact) throw codedError(ERR.E_NOT_FOUND);
  return {
    fact_id: factId,
    current_status: fact.status,
    events: events.filter((event) => isVerdictEventFor(event, factId)).map(verdictEvent),
  };
}
