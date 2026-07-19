import { kvCommand } from "./_kv.js";

const ACCENTS = {
  S: "#00E6A1",
  A: "#22d3c5",
  B: "#facc15",
  C: "#fb923c",
  F: "#ef4444",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cardId(req) {
  const raw = req.query?.id ?? new URL(req.url, "https://nautli.ai").searchParams.get("id");
  return Array.isArray(raw) ? raw[0] : raw;
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(html);
}

function pageShell({ title, description, content, accent = "#00E6A1", canonical = "" }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return `<!doctype html>
<html lang="ko" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="nautli">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="https://nautli.ai/assets/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  ${canonical ? `<meta property="og:url" content="${escapeHtml(canonical)}"><link rel="canonical" href="${escapeHtml(canonical)}">` : ""}
  <style>
    :root{color-scheme:dark;--bg:#141414;--card:#1c1c1a;--border:#2a2a27;--text:#F7F7F5;--dim:#a3a39e;--faint:#87877f;--accent:${accent}}
    *{box-sizing:border-box}body{min-width:320px;margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{display:grid;min-height:100svh;place-items:center;padding:clamp(24px,5vw,72px)}
    .wrap{width:min(100%,1200px)}
    .score-card{position:relative;display:flex;width:100%;aspect-ratio:1200/630;flex-direction:column;justify-content:space-between;overflow:hidden;border:1px solid var(--border);border-radius:clamp(12px,2vw,24px);background:var(--card);padding:clamp(16px,4.8vw,58px)}
    .score-card::before{position:absolute;inset:0 auto 0 0;width:clamp(6px,1vw,12px);background:var(--accent);content:""}
    .brand{font-size:clamp(17px,2.5vw,30px);font-weight:700;letter-spacing:-.03em}.brand span{color:var(--accent)}
    .center{display:flex;align-items:center;gap:clamp(14px,3vw,36px)}
    .score{font-size:clamp(58px,15vw,190px);font-weight:700;line-height:.78;letter-spacing:-.075em}
    .grade{display:grid;width:clamp(52px,10vw,116px);aspect-ratio:1;place-items:center;border:2px solid var(--accent);border-radius:50%;color:var(--accent);font-size:clamp(27px,6vw,68px);font-weight:700}
    .nick{margin-top:clamp(9px,1.6vw,20px);color:var(--dim);font-size:clamp(12px,2vw,22px)}
    .bottom{display:flex;align-items:end;justify-content:space-between;gap:20px}
    .stats{margin:0;color:var(--dim);font-size:clamp(11px,2vw,24px);font-weight:500;white-space:nowrap}
    .site{color:var(--faint);font-size:clamp(11px,1.8vw,21px);white-space:nowrap}
    .cta{display:flex;justify-content:center;margin-top:28px}.cta a{display:inline-flex;min-height:48px;align-items:center;border-radius:8px;background:var(--accent);padding:10px 18px;color:#141414;font-weight:700;text-decoration:none}
    .notice{text-align:center}.notice h1{font-size:clamp(30px,7vw,56px);letter-spacing:-.04em}.notice p{color:var(--dim)}
    @media(max-width:520px){.score-card{border-radius:12px}.bottom{gap:8px}.stats{letter-spacing:-.04em}}
  </style>
</head>
<body><main><div class="wrap">${content}</div></main></body>
</html>`;
}

function cardPage(card) {
  const grade = Object.hasOwn(ACCENTS, card.grade) ? card.grade : "F";
  const score = Number.isInteger(card.score) ? card.score : 20;
  const tools = Number.isInteger(card.tools) ? card.tools : 0;
  const tokens = Number.isInteger(card.tokens) ? card.tokens : 0;
  const findings = Number.isInteger(card.findings) ? card.findings : 0;
  const nick = typeof card.nick === "string" && card.nick
    ? `<div class="nick">${escapeHtml(card.nick)}</div>`
    : "";
  const title = `nautli memory score ${score} · ${grade}`;
  return pageShell({
    title,
    description: `AI memory score ${score}, grade ${grade}.`,
    accent: ACCENTS[grade],
    canonical: `https://nautli.ai/r/${escapeHtml(card.id)}`,
    content: `<article class="score-card" aria-label="nautli memory score ${score}, grade ${grade}">
      <div class="brand">nautli<span>.</span></div>
      <div><div class="center"><div class="score">${score}</div><div class="grade">${grade}</div></div>${nick}</div>
      <div class="bottom"><p class="stats">AI ${tools}개 · 기억 ${tokens.toLocaleString("en-US")}tok · 신호 ${findings}건</p><span class="site">nautli.ai</span></div>
    </article>
    <div class="cta"><a href="/diagnose">내 점수도 재보기 →</a></div>`,
  });
}

function notFoundPage() {
  return pageShell({
    title: "카드를 찾을 수 없습니다 · nautli",
    description: "이 공유 카드는 없거나 삭제되었습니다.",
    content: `<section class="notice"><h1>카드를 찾을 수 없습니다</h1><p>링크가 정확한지 확인하거나 새 진단을 시작해 주세요.</p><div class="cta"><a href="/diagnose">내 점수 진단하기 →</a></div></section>`,
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendHtml(res, 405, pageShell({
      title: "Method not allowed · nautli",
      description: "Method not allowed.",
      content: `<section class="notice"><h1>Method not allowed</h1><div class="cta"><a href="/diagnose">진단하기 →</a></div></section>`,
    }));
    return;
  }

  const id = cardId(req);
  if (typeof id !== "string" || !/^[a-z0-9]{8}$/u.test(id)) {
    sendHtml(res, 404, notFoundPage());
    return;
  }
  try {
    const stored = await kvCommand(["GET", `nt:card:${id}`]);
    if (!stored) {
      sendHtml(res, 404, notFoundPage());
      return;
    }
    sendHtml(res, 200, cardPage(JSON.parse(stored)));
  } catch {
    sendHtml(res, 500, pageShell({
      title: "잠시 후 다시 시도해 주세요 · nautli",
      description: "카드를 불러오지 못했습니다.",
      content: `<section class="notice"><h1>카드를 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요.</p><div class="cta"><a href="/diagnose">진단하기 →</a></div></section>`,
    }));
  }
}
