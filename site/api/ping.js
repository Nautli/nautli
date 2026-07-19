import { hashResult, kvCommand, kvPipeline, rateLimit } from "./_kv.js";
import {
  percentileFromHistogram,
  readJsonBody,
  validatePingPayload,
} from "./_validate.js";

const HISTOGRAM_KEY = "nt:hist";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(raw || req.socket?.remoteAddress || "unknown").split(",")[0].trim().slice(0, 128);
}

function isoWeek(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  current.setUTCDate(current.getUTCDate() + 4 - (current.getUTCDay() || 7));
  const year = current.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((current - yearStart) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid JSON body" });
    return;
  }
  const validated = validatePingPayload(body);
  if (!validated.ok) {
    sendJson(res, 400, { ok: false, error: validated.error });
    return;
  }

  try {
    const limit = await rateLimit(`nt:rl:ping:${clientIp(req)}`, 60, 3_600);
    if (!limit.allowed) {
      sendJson(res, 429, { ok: false, error: "rate limit exceeded" });
      return;
    }

    const { score } = validated.value;
    const weekKey = `nt:stats:week:${isoWeek()}`;
    await kvPipeline([
      ["HINCRBY", HISTOGRAM_KEY, score, 1],
      ["INCR", "nt:stats:count"],
      ["INCRBY", "nt:stats:sum", score],
      ["INCR", weekKey],
      ["EXPIRE", weekKey, 14 * 24 * 60 * 60],
    ]);
    const summary = percentileFromHistogram(
      hashResult(await kvCommand(["HGETALL", HISTOGRAM_KEY])),
      score,
    );
    sendJson(res, 200, { ok: true, ...summary });
  } catch {
    sendJson(res, 500, { ok: false, error: "service unavailable" });
  }
}
