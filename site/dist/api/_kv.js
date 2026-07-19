function environment() {
  const url = process.env.KV_REST_API_URL?.replace(/\/+$/u, "");
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV is not configured");
  return { url, token };
}

export function assertNtKey(key) {
  if (typeof key !== "string" || !key.startsWith("nt:")) {
    throw new Error("KV keys must use the nt: prefix");
  }
  return key;
}

function assertCommandKeys(command) {
  if (!Array.isArray(command) || command.length < 2) {
    throw new TypeError("KV command must include a key");
  }
  const name = String(command[0]).toUpperCase();
  if (name === "MGET") {
    for (const key of command.slice(1)) assertNtKey(key);
    return;
  }
  assertNtKey(command[1]);
}

async function request(pathname, body) {
  const { url, token } = environment();
  const response = await fetch(`${url}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("KV request failed");
  const payload = await response.json();
  if (payload?.error) throw new Error("KV command failed");
  return payload?.result;
}

export async function kvCommand(command) {
  assertCommandKeys(command);
  return request("", command);
}

export async function kvPipeline(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new TypeError("KV pipeline must not be empty");
  }
  for (const command of commands) assertCommandKeys(command);
  const { url, token } = environment();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("KV request failed");
  const results = await response.json();
  if (!Array.isArray(results) || results.some((entry) => entry?.error)) {
    throw new Error("KV pipeline failed");
  }
  return results.map((entry) => entry?.result);
}

export async function rateLimit(key, maximum, windowSeconds) {
  assertNtKey(key);
  const count = Number(await kvCommand(["INCR", key]));
  if (count === 1) await kvCommand(["EXPIRE", key, windowSeconds]);
  return { allowed: count <= maximum, count };
}

export function hashResult(value) {
  if (!value) return {};
  if (!Array.isArray(value)) return value;
  const result = {};
  for (let index = 0; index < value.length; index += 2) {
    result[String(value[index])] = value[index + 1];
  }
  return result;
}
