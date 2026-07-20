import { randomBytes } from "node:crypto";
import { hashResult, kvCommand, kvMultiExec, rateLimit } from "./_kv.js";
import {
  estimateMonthlyUsd,
  gradeForScore,
  percentileFromHistogram,
  readJsonBody,
  validateSharePayload,
} from "./_validate.js";

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

function createId() {
  return randomBytes(6).readUIntBE(0, 6).toString(36).padStart(10, "0").slice(-8);
}

async function unusedId() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = createId();
    if (!Number(await kvCommand(["EXISTS", `nt:card:${id}`]))) return id;
  }
  throw new Error("card id collision");
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
  const validated = validateSharePayload(body);
  if (!validated.ok) {
    sendJson(res, 400, { ok: false, error: validated.error });
    return;
  }

  try {
    const limit = await rateLimit(`nt:rl:share:${clientIp(req)}`, 10, 3_600);
    if (!limit.allowed) {
      sendJson(res, 429, { ok: false, error: "rate limit exceeded" });
      return;
    }

    const value = validated.value;
    const histogram = hashResult(await kvCommand(["HGETALL", "nt:hist"]));
    const summary = percentileFromHistogram(histogram, value.score);
    const id = await unusedId();
    const card = {
      id,
      score: value.score,
      grade: gradeForScore(value.score),
      percentile: summary.percentile,
      tools: value.tools,
      tokens: value.tokens,
      alTokens: value.alTokens,
      findings: value.findings,
      estMonthlyUsd: estimateMonthlyUsd(value.alTokens),
      nick: value.nick,
      os: value.os,
      ts: Date.now(),
    };
    const results = await kvMultiExec([
      ["SET", `nt:card:${id}`, JSON.stringify(card)],
      ["LPUSH", "nt:cards:recent", id],
      ["LTRIM", "nt:cards:recent", 0, 199],
      ["ZADD", "nt:cards:byscore", value.score, id],
    ]);
    if (results[0] !== "OK") throw new Error("card storage failed");
    sendJson(res, 200, { ok: true, id, url: `https://nautli.ai/r/${id}` });
  } catch {
    sendJson(res, 500, { ok: false, error: "service unavailable" });
  }
}
