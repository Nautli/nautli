const BASE_KEYS = ["v", "score", "tools", "tokens", "alTokens", "findings", "os"];
const OS_VALUES = new Set(["mac", "win", "linux"]);

const fail = (error) => ({ ok: false, error });

function validateObject(payload, allowedKeys) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return fail("body must be a JSON object");
  }
  const extra = Object.keys(payload).find((key) => !allowedKeys.has(key));
  return extra ? fail(`unexpected field: ${extra}`) : null;
}

function validateInteger(payload, key, minimum, maximum) {
  const value = payload[key];
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    return fail(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return null;
}

function validateBase(payload, allowedKeys) {
  const objectError = validateObject(payload, allowedKeys);
  if (objectError) return objectError;
  if (payload.v !== 1) return fail("v must be 1");

  for (const [key, minimum, maximum] of [
    ["score", 20, 100],
    ["tools", 0, 20],
    ["tokens", 0, 10_000_000],
    ["alTokens", 0, 10_000_000],
    ["findings", 0, 500],
  ]) {
    const integerError = validateInteger(payload, key, minimum, maximum);
    if (integerError) return integerError;
  }

  if (payload.alTokens > payload.tokens) {
    return fail("alTokens must not exceed tokens");
  }
  if (!OS_VALUES.has(payload.os)) {
    return fail("os must be mac, win, or linux");
  }
  return null;
}

export function sanitizeNick(value) {
  if (typeof value !== "string") return "";
  return Array.from(value.normalize("NFC").replace(/[^\p{L}\p{N} ._-]/gu, ""))
    .slice(0, 20)
    .join("");
}

export function validatePingPayload(payload) {
  const validationError = validateBase(payload, new Set(BASE_KEYS));
  if (validationError) return validationError;
  return {
    ok: true,
    value: Object.fromEntries(BASE_KEYS.map((key) => [key, payload[key]])),
  };
}

export function validateSharePayload(payload) {
  const validationError = validateBase(payload, new Set([...BASE_KEYS, "nick"]));
  if (validationError) return validationError;
  if (payload.nick !== undefined && typeof payload.nick !== "string") {
    return fail("nick must be a string");
  }
  return {
    ok: true,
    value: {
      ...Object.fromEntries(BASE_KEYS.map((key) => [key, payload[key]])),
      nick: sanitizeNick(payload.nick),
    },
  };
}

export function gradeForScore(score) {
  if (score >= 90) return "S";
  if (score >= 78) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "F";
}

export function estimateMonthlyUsd(alTokens) {
  return Math.round((alTokens / 1_000_000) * 3 * 10 * 30 * 10) / 10;
}

export function percentileFromHistogram(histogram, score) {
  let count = 0;
  let lower = 0;
  for (const [rawScore, rawCount] of Object.entries(histogram)) {
    const bucketScore = Number(rawScore);
    const bucketCount = Number(rawCount) || 0;
    count += bucketCount;
    if (bucketScore < score) lower += bucketCount;
  }
  return {
    count,
    ...(count > 0 ? { percentile: Math.min(99, Math.floor((100 * lower) / count)) } : {}),
  };
}

export async function readJsonBody(req, limit = 16_384) {
  const declaredLength = Number(req.headers?.["content-length"] || 0);
  if (declaredLength > limit) throw new SyntaxError("request body is too large");
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8"));
    if (typeof req.body === "string") return JSON.parse(req.body);
    return req.body;
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > limit) throw new SyntaxError("request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
