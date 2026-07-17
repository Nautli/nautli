// nautli 판정 메타 수집 엔드포인트 (v1)
// 원칙: 내용 무수신 — 숫자·enum·uuid·버전 외 문자열은 400으로 거부한다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[0-9A-Za-z.\-+]{1,32}$/;
const PLATFORMS = new Set(["darwin", "linux", "win32"]);

function onlyNumericLeaves(value, depth = 0) {
  if (depth > 4) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null) return true;
  if (Array.isArray(value)) return false;
  if (typeof value === "object") {
    return Object.entries(value).every(([k, v]) =>
      /^[a-z0-9_.]{1,64}$/i.test(k) && onlyNumericLeaves(v, depth + 1));
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const body = req.body;
  if (!body || typeof body !== "object") return res.status(400).end();
  const raw = JSON.stringify(body);
  if (raw.length > 10_000) return res.status(413).end();
  if (body.schema_version !== 1
    || !UUID_RE.test(String(body.install_id ?? ""))
    || !VERSION_RE.test(String(body.app_version ?? ""))
    || !PLATFORMS.has(body.platform)
    || !onlyNumericLeaves(body.counts ?? {})) {
    return res.status(400).end();
  }
  const record = JSON.stringify({
    at: new Date().toISOString(),
    install_id: body.install_id,
    app_version: body.app_version,
    platform: body.platform,
    counts: body.counts,
  });
  const day = new Date().toISOString().slice(0, 10);
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/rpush/${encodeURIComponent(`nautli:telemetry:${day}`)}`;
  // Upstash REST: body 전체가 rpush의 단일 요소가 된다 — 레코드 문자열을 그대로 보낸다.
  const stored = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: record,
  }).then((r) => r.ok).catch(() => false);
  return res.status(stored ? 204 : 502).end();
}
