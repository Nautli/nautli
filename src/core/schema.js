import { createHash, randomBytes } from "node:crypto";

export const ERR = Object.freeze({
  E_INVALID_INPUT: "E_INVALID_INPUT",
  E_MULTI_FACT: "E_MULTI_FACT",
  E_CLAIM_TOO_LONG: "E_CLAIM_TOO_LONG",
  E_UNKNOWN_SCOPE: "E_UNKNOWN_SCOPE",
  E_NOT_FOUND: "E_NOT_FOUND",
  E_STORE_BUSY: "E_STORE_BUSY",
  E_BUDGET_TOO_SMALL: "E_BUDGET_TOO_SMALL",
  E_CLAUDE_CLI_MISSING: "E_CLAUDE_CLI_MISSING",
  E_MCP_REGISTER_FAILED: "E_MCP_REGISTER_FAILED",
  E_LAUNCHCTL_FAILED: "E_LAUNCHCTL_FAILED",
  W_DUPLICATE: "W_DUPLICATE",
  W_EMPTY: "W_EMPTY",
});

export const STATUS = Object.freeze({
  ACTIVE: "active",
  SUPERSEDED: "superseded",
  INVALIDATED: "invalidated",
  ARCHIVED: "archived",
});

const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";

function encodeRandom(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }

  return output;
}

export function newId(now = Date.now()) {
  const timestamp = Math.max(0, Math.trunc(Number(now))).toString(32).padStart(10, "0").slice(-10);
  return `fa_${timestamp}${encodeRandom(randomBytes(8)).slice(0, 13)}`;
}

export function validScope(scope) {
  // project 이름은 유니코드 문자·숫자 허용 (한글 프로젝트명 — 한국 유저의 CLAUDE.md 지시문이 project:<프로젝트명>을 시킨다)
  return scope === "person"
    || scope === "procedure"
    || /^project:[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)*$/u.test(scope);
}

export function normalizeClaim(claim) {
  if (typeof claim !== "string") return "";
  return claim
    .toLowerCase()
    .replace(/[\p{P}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function claimHash(claim) {
  return createHash("sha1").update(normalizeClaim(claim)).digest("hex");
}

export function assertTransition(from, to, actor) {
  const allowed = actor === "daemon"
    ? (from === STATUS.ACTIVE && [STATUS.SUPERSEDED, STATUS.INVALIDATED, STATUS.ARCHIVED].includes(to))
      || (from === STATUS.ARCHIVED && to === STATUS.ACTIVE)
    : actor === "client"
      && from === STATUS.ACTIVE
      && to === STATUS.SUPERSEDED;

  if (!allowed) {
    throw new Error(`Invalid transition: ${actor}:${from}->${to}`);
  }
}
