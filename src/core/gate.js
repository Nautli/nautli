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

function rejected(reason) {
  return { status: "rejected", reason };
}

function validOptionalInputs(input) {
  if (input.type !== undefined && !FACT_TYPES.has(input.type)) return false;
  if (input.subject !== undefined && typeof input.subject !== "string") return false;
  if (input.t_valid !== undefined && (typeof input.t_valid !== "string" || input.t_valid.length === 0)) return false;
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
    t_valid: input.t_valid ?? new Date().toISOString().slice(0, 10),
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
    store.addFact(fact);
    store.transition(oldFact.id, STATUS.SUPERSEDED, {
      superseded_by: fact.id,
      t_invalid: fact.t_valid,
    }, "client");
    touchSpool(store.home);
    return { id: fact.id, status: "added" };
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
  store.addFact(fact);
  touchSpool(store.home);
  return { id: fact.id, status: "added" };
}
