import { kvCommand, kvPipeline } from "./_kv.js";

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

function isoWeek(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  current.setUTCDate(current.getUTCDate() + 4 - (current.getUTCDay() || 7));
  const year = current.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((current - yearStart) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function parseCard(value) {
  if (typeof value !== "string") return null;
  try {
    const card = JSON.parse(value);
    return card && typeof card === "object" ? card : null;
  } catch {
    return null;
  }
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

  try {
    const [rawCount, rawSum, rawWeek, recentIds = [], topIds = [], bottomIds = []] = await kvPipeline([
      ["GET", "nt:stats:count"],
      ["GET", "nt:stats:sum"],
      ["GET", `nt:stats:week:${isoWeek()}`],
      ["LRANGE", "nt:cards:recent", 0, 23],
      ["ZREVRANGE", "nt:cards:byscore", 0, 11],
      ["ZRANGE", "nt:cards:byscore", 0, 11],
    ]);
    const allIds = [...new Set([...recentIds, ...topIds, ...bottomIds])];
    const storedCards = allIds.length > 0
      ? await kvCommand(["MGET", ...allIds.map((id) => `nt:card:${id}`)])
      : [];
    const cardsById = new Map(
      allIds.map((id, index) => [id, parseCard(storedCards?.[index])]),
    );
    const cardsFor = (ids) => ids.map((id) => cardsById.get(id)).filter(Boolean);
    const count = Math.max(0, Number(rawCount) || 0);
    const sum = Number(rawSum) || 0;

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    sendJson(res, 200, {
      ok: true,
      stats: {
        count,
        avg: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
        week: Math.max(0, Number(rawWeek) || 0),
      },
      recent: cardsFor(recentIds),
      top: cardsFor(topIds),
      bottom: cardsFor(bottomIds),
    });
  } catch {
    sendJson(res, 500, { ok: false, error: "service unavailable" });
  }
}
