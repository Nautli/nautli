import { kvCommand } from "./_kv.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function cardId(req) {
  const raw = req.query?.id ?? new URL(req.url, "https://nautli.ai").searchParams.get("id");
  return Array.isArray(raw) ? raw[0] : raw;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  const id = cardId(req);
  if (typeof id !== "string" || !/^[a-z0-9]{8}$/u.test(id)) {
    sendJson(res, 400, { ok: false, error: "invalid card id" });
    return;
  }
  try {
    const stored = await kvCommand(["GET", `nt:card:${id}`]);
    if (!stored) {
      sendJson(res, 404, { ok: false, error: "card not found" });
      return;
    }
    sendJson(res, 200, { ok: true, card: JSON.parse(stored) });
  } catch {
    sendJson(res, 500, { ok: false, error: "service unavailable" });
  }
}
