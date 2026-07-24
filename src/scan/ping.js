const OS_VALUES = new Set(["mac", "win", "linux"]);

function integer(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function safeOs(value) {
  return OS_VALUES.has(value) ? value : "linux";
}

/** Hard allowlist serializer: no result field can pass through implicitly. */
export function buildPingPayload(result) {
  const tokens = integer(result?.totals?.tokens, { max: 10_000_000 });
  return {
    v: 1,
    score: integer(result?.score, { min: 0, max: 100, fallback: 0 }),
    tools: integer(result?.tools?.length, { max: 20 }),
    tokens,
    alTokens: integer(result?.totals?.alTokens, { max: tokens }),
    findings: integer(result?.findings?.length, { max: 500 }),
    os: safeOs(result?.os),
  };
}

/** Share uses the same numeric allowlist and permits only one optional string. */
export function buildSharePayload(result, nick) {
  const payload = buildPingPayload(result);
  if (typeof nick === "string" && nick.trim().length > 0) {
    payload.nick = [...nick.trim()].slice(0, 20).join("");
  }
  return payload;
}

export async function ping(result, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 2_000,
} = {}) {
  if (typeof fetchImpl !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl("https://nautli.ai/api/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPingPayload(result)),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.ok !== true || !Number.isInteger(data.count)) return null;
    return {
      ok: true,
      count: data.count,
      ...(Number.isInteger(data.percentile)
        ? { percentile: Math.min(99, Math.max(0, data.percentile)) }
        : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const sendPing = ping;
