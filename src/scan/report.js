import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildSharePayload } from "./ping.js";

const COPY = Object.freeze({
  en: {
    title: "AI memory scan",
    eyebrow: "LOCAL, READ-ONLY DIAGNOSIS",
    score: "memory score",
    top: (value) => `Top ${value}%`,
    monthly: (value) => `About $${value} a month is spent reloading stale memory`,
    assumption: "Estimate only. Assumes $3 per 1M input tokens, 10 sessions a day, and 30 days a month.",
    tools: "Memory by tool",
    tool: "Tool",
    files: "Files",
    tokens: "Estimated tokens",
    findings: "Signals to review",
    clean: "No weighted signals were found in the discovered files.",
    evidence: (count) => `Show ${count} local file paths`,
    share: "Share your score",
    shareBody: "The card contains aggregate numbers only. Saving PNG never uploads it.",
    nick: "Nickname (optional)",
    png: "Save card PNG",
    sharing: "Creating link...",
    shareButton: "Create share link",
    shareError: "Could not create link",
    pngError: "Could not save PNG",
    copied: "Link copied",
    ready: "Share link ready",
    footerSent: "Sent: only 7 anonymous fields (score, tools, tokens, alTokens, findings, os, v). File names and contents never leave this device.",
    footerFailed: "Sending failed. No scan aggregate was sent. File names and contents never leave this device.",
    footerDisabled: "Ping disabled. No scan aggregate was sent. File names and contents never leave this device.",
    install: "Install nautli",
    cardStats: (tools, tokens, findings) => `AI ${tools} · memory ${tokens}tok · signals ${findings}`,
    partial: "The scan reached its safety cap, so this is a partial result.",
  },
  ko: {
    title: "AI 기억 진단",
    eyebrow: "로컬 읽기 전용 진단",
    score: "기억 점수",
    top: (value) => `상위 ${value}%`,
    monthly: (value) => `매달 약 $${value}를 낡은 기억 재로드에 지불 중`,
    assumption: "추정치입니다. 입력 토큰 100만 개당 $3, 하루 10세션, 월 30일을 가정했습니다.",
    tools: "도구별 기억",
    tool: "도구",
    files: "파일 수",
    tokens: "추정 토큰",
    findings: "검토할 신호",
    clean: "발견한 파일에서 점수에 반영할 신호가 없었습니다.",
    evidence: (count) => `로컬 파일 경로 ${count}개 보기`,
    share: "점수 공유",
    shareBody: "카드에는 집계 숫자만 들어갑니다. PNG 저장은 업로드하지 않습니다.",
    nick: "닉네임 (선택)",
    png: "카드 PNG 저장",
    sharing: "링크 만드는 중...",
    shareButton: "공유 링크 만들기",
    shareError: "링크를 만들지 못했습니다",
    pngError: "PNG를 저장하지 못했습니다",
    copied: "링크를 복사했습니다",
    ready: "공유 링크가 준비됐습니다",
    footerSent: "전송됨: 숫자 7개뿐(score, tools, tokens, alTokens, findings, os, v). 파일명과 내용은 기기를 떠나지 않습니다.",
    footerFailed: "전송 실패: 진단 집계를 보내지 못했습니다. 파일명과 내용은 기기를 떠나지 않습니다.",
    footerDisabled: "핑 비활성화: 진단 집계를 보내지 않았습니다. 파일명과 내용은 기기를 떠나지 않습니다.",
    install: "nautli 설치",
    cardStats: (tools, tokens, findings) => `AI ${tools}개 · 기억 ${tokens}tok · 신호 ${findings}건`,
    partial: "안전 제한에 도달해 일부만 진단한 결과입니다.",
  },
  ja: {
    title: "AI記憶診断",
    eyebrow: "ローカル・読み取り専用の診断",
    score: "記憶スコア",
    top: (value) => `上位 ${value}%`,
    monthly: (value) => `毎月 約$${value}を古い記憶の再読み込みに支払っています`,
    assumption: "推定値です。入力トークン100万個あたり$3、1日10セッション、月30日を仮定しています。",
    tools: "ツール別の記憶",
    tool: "ツール",
    files: "ファイル数",
    tokens: "推定トークン",
    findings: "確認すべきシグナル",
    clean: "発見したファイルにスコアへ反映するシグナルはありませんでした。",
    evidence: (count) => `ローカルファイルのパス${count}件を表示`,
    share: "スコアを共有",
    shareBody: "カードには集計の数値のみが入ります。PNG保存でアップロードは行いません。",
    nick: "ニックネーム（任意）",
    png: "カードPNGを保存",
    sharing: "リンクを作成中...",
    shareButton: "共有リンクを作成",
    shareError: "リンクを作成できませんでした",
    pngError: "PNGを保存できませんでした",
    copied: "リンクをコピーしました",
    ready: "共有リンクの準備ができました",
    footerSent: "送信済み: 匿名の集計フィールド7つのみ（score, tools, tokens, alTokens, findings, os, v）。ファイル名と内容はこの端末を離れません。",
    footerFailed: "送信失敗: 診断の集計を送信できませんでした。ファイル名と内容はこの端末を離れません。",
    footerDisabled: "Ping無効: 診断の集計は送信していません。ファイル名と内容はこの端末を離れません。",
    install: "nautliをインストール",
    cardStats: (tools, tokens, findings) => `AIツール${tools}個 · 記憶 ${tokens}tok · シグナル${findings}件`,
    partial: "安全上限に達したため、一部のみ診断した結果です。",
  },
});

const GRADE_COLORS = Object.freeze({
  S: "#00E6A1",
  A: "#12A88F",
  B: "#E6C84F",
  C: "#E68A3A",
  F: "#E65A5A",
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function toolRows(result, text) {
  return result.tools.map((tool) => `
    <tr>
      <td>${escapeHtml(tool.id)}</td>
      <td>${tool.files.toLocaleString()}</td>
      <td>${tool.tokens.toLocaleString()}</td>
    </tr>`).join("");
}

function findingCards(result, text) {
  if (result.findings.length === 0) return `<p class="empty">${escapeHtml(text.clean)}</p>`;
  return result.findings.map((finding) => `
    <article class="finding finding-${escapeHtml(finding.group)}">
      <div class="finding-head"><span class="group">${escapeHtml(finding.group)}</span><span class="weight">${finding.weight > 0 ? `W${finding.weight}` : "INFO"}</span></div>
      <h3>${escapeHtml(finding.title)}</h3>
      <p class="measure">${escapeHtml(finding.measure)}</p>
      <p>${escapeHtml(finding.why)}</p>
      <details>
        <summary>${escapeHtml(text.evidence(finding.files.length))}</summary>
        <ul>${finding.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul>
      </details>
    </article>`).join("");
}

export function renderReportHtml(result, { lang = "en", percentile, pingStatus = "disabled" } = {}) {
  const selectedLang = lang === "ko" || lang === "ja" ? lang : "en";
  const text = COPY[selectedLang];
  const accent = GRADE_COLORS[result.grade] ?? GRADE_COLORS.F;
  const topPercent = Number.isInteger(percentile) ? Math.max(1, 100 - percentile) : null;
  const footer = pingStatus === "sent"
    ? text.footerSent
    : pingStatus === "failed"
      ? text.footerFailed
      : text.footerDisabled;
  const safeShareBase = buildSharePayload(result);
  const browserData = {
    payload: safeShareBase,
    grade: result.grade,
    estMonthlyUsd: result.estMonthlyUsd,
    cardStats: text.cardStats(
      safeShareBase.tools,
      safeShareBase.tokens.toLocaleString(selectedLang),
      safeShareBase.findings,
    ),
    labels: {
      png: text.png,
      pngError: text.pngError,
      sharing: text.sharing,
      shareButton: text.shareButton,
      shareError: text.shareError,
      copied: text.copied,
      ready: text.ready,
    },
  };

  return `<!doctype html>
<html lang="${selectedLang}" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(text.title)} · nautli</title>
  <style>
    :root{color-scheme:dark;--bg:#141414;--card:#1c1c1a;--border:#2a2a27;--text:#F7F7F5;--dim:#a3a39e;--faint:#87877f;--accent:#00E6A1;--accent-soft:#00E6A114;--grade:${accent};font-family:${selectedLang === "ja" ? 'Inter,"Noto Sans JP","Hiragino Sans","Noto Sans KR"' : 'Inter,Pretendard,"Noto Sans KR","Noto Sans JP"'},-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{min-width:320px;margin:0;background:var(--bg);color:var(--text);font-size:16px;line-height:1.6}a{color:var(--accent);text-underline-offset:4px}button,input{font:inherit}:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.shell{width:min(90%,1080px);margin:auto;padding:64px 0}.eyebrow,.group,.weight{color:var(--faint);font:700 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}.hero{display:grid;grid-template-columns:minmax(230px,.75fr) minmax(280px,1.25fr);gap:48px;align-items:end;padding-bottom:56px;border-bottom:1px solid var(--border)}.score-line{display:flex;align-items:center;gap:18px}.score{font-size:clamp(86px,15vw,168px);font-weight:800;line-height:.8;letter-spacing:-.08em}.grade{display:grid;width:64px;height:64px;place-items:center;border:1px solid var(--grade);border-radius:12px;background:color-mix(in srgb,var(--grade) 12%,transparent);color:var(--grade);font-size:30px;font-weight:800}.score-label,.percentile{margin:18px 0 0;color:var(--dim)}.percentile{display:inline-block;margin-left:12px;padding:4px 10px;border:1px solid var(--grade);border-radius:999px;color:var(--grade)}h1{max-width:700px;margin:0 0 16px;font-size:clamp(34px,5vw,60px);line-height:1.08;letter-spacing:-.04em}.assumption{max-width:700px;margin:0;color:var(--faint);font-size:13px}.partial{margin-top:20px;padding:12px 16px;border:1px solid var(--grade);border-radius:8px;color:var(--dim)}section{padding:56px 0;border-bottom:1px solid var(--border)}h2{margin:0 0 24px;font-size:32px;letter-spacing:-.03em}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}th,td{padding:15px 18px;border-bottom:1px solid var(--border);text-align:right}th{color:var(--faint);font-size:13px}th:first-child,td:first-child{text-align:left}tr:last-child td{border-bottom:0}.findings{display:grid;gap:16px}.finding{padding:24px;border:1px solid var(--border);border-radius:12px;background:var(--card)}.finding-crossTool{border-color:var(--grade)}.finding-head{display:flex;justify-content:space-between}.finding h3{margin:12px 0 6px;font-size:20px}.finding p{margin:8px 0;color:var(--dim)}.finding .measure{color:var(--text);font-weight:650}details{margin-top:16px}summary{min-height:44px;color:var(--faint);cursor:pointer}li{overflow-wrap:anywhere;color:var(--dim);font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}.share-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(260px,.7fr);gap:32px;align-items:center}.share-card{position:relative;aspect-ratio:1200/630;padding:clamp(24px,4vw,52px);overflow:hidden;border:1px solid var(--border);border-radius:12px;background:#1c1c1a}.card-wordmark{font-size:24px;font-weight:800}.card-score{position:absolute;top:50%;left:50%;display:flex;align-items:center;gap:24px;transform:translate(-50%,-54%)}.card-score strong{font-size:clamp(74px,13vw,150px);line-height:1;letter-spacing:-.08em}.card-grade{color:var(--grade);font-size:clamp(36px,6vw,68px);font-weight:800}.card-stats{position:absolute;left:clamp(24px,4vw,52px);bottom:clamp(24px,4vw,52px);margin:0;color:var(--dim)}.card-domain{position:absolute;right:clamp(24px,4vw,52px);bottom:clamp(24px,4vw,52px);color:var(--faint);font-weight:700}.share-copy p{color:var(--dim)}label{display:block;margin:20px 0 6px;color:var(--faint);font-size:13px}input{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)}.actions{display:grid;gap:10px;margin-top:14px}button,.install{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:10px 16px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text);font-weight:700;cursor:pointer}.primary{border-color:var(--accent);background:var(--accent);color:#141414}.status{min-height:26px;margin:12px 0 0;color:var(--dim);overflow-wrap:anywhere}.status a{display:block}.privacy{padding:36px 0;color:var(--dim)}.privacy-inner{display:flex;align-items:center;justify-content:space-between;gap:24px}.privacy p{max-width:760px;margin:0}.install{text-decoration:none;white-space:nowrap}@media(max-width:760px){.shell{padding-top:36px}.hero,.share-grid{grid-template-columns:1fr;gap:28px}.score{font-size:112px}.share-card{padding:22px}.card-stats{left:22px;bottom:22px;max-width:68%;font-size:12px}.card-domain{right:22px;bottom:22px;font-size:12px}.privacy-inner{align-items:stretch;flex-direction:column}.install{width:100%}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="hero">
      <div>
        <p class="eyebrow">${escapeHtml(text.eyebrow)}</p>
        <div class="score-line"><strong class="score">${result.score}</strong><span class="grade">${escapeHtml(result.grade)}</span></div>
        <span class="score-label">${escapeHtml(text.score)}</span>${topPercent === null ? "" : `<span class="percentile">${escapeHtml(text.top(topPercent))}</span>`}
      </div>
      <div>
        <h1>${escapeHtml(text.monthly(result.estMonthlyUsd.toFixed(1)))}</h1>
        <p class="assumption">${escapeHtml(text.assumption)}</p>
        ${result.partial ? `<p class="partial">${escapeHtml(text.partial)}</p>` : ""}
      </div>
    </div>
    <section><h2>${escapeHtml(text.tools)}</h2><table><thead><tr><th>${escapeHtml(text.tool)}</th><th>${escapeHtml(text.files)}</th><th>${escapeHtml(text.tokens)}</th></tr></thead><tbody>${toolRows(result, text)}</tbody></table></section>
    <section><h2>${escapeHtml(text.findings)}</h2><div class="findings">${findingCards(result, text)}</div></section>
    <section>
      <div class="share-grid">
        <div class="share-card" id="share-card" aria-label="nautli score card">
          <span class="card-wordmark">nautli</span>
          <div class="card-score"><strong>${result.score}</strong><span class="card-grade">${escapeHtml(result.grade)}</span></div>
          <p class="card-stats">${escapeHtml(browserData.cardStats)}</p><span class="card-domain">nautli.ai</span>
        </div>
        <div class="share-copy">
          <h2>${escapeHtml(text.share)}</h2><p>${escapeHtml(text.shareBody)}</p>
          <label for="nick">${escapeHtml(text.nick)}</label><input id="nick" maxlength="20" autocomplete="nickname">
          <div class="actions"><button id="save-png" type="button">${escapeHtml(text.png)}</button><button id="create-share" class="primary" type="button">${escapeHtml(text.shareButton)}</button></div>
          <p class="status" id="share-status" role="status" aria-live="polite"></p>
        </div>
      </div>
    </section>
    <footer class="privacy"><div class="privacy-inner"><p>${escapeHtml(footer)}</p><a class="install primary" href="https://nautli.ai/install">${escapeHtml(text.install)}</a></div></footer>
  </main>
  <script>
    (() => {
      "use strict";
      const data = ${jsonForScript(browserData)};
      const pngButton = document.getElementById("save-png");
      const shareButton = document.getElementById("create-share");
      const status = document.getElementById("share-status");
      const nick = document.getElementById("nick");
      const colors = { S: "#00E6A1", A: "#12A88F", B: "#E6C84F", C: "#E68A3A", F: "#E65A5A" };

      function asInt(value, min, max, fallback) {
        return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
      }
      function buildSharePayload(base, nickname) {
        const tokens = asInt(base.tokens, 0, 10000000, 0);
        const payload = {
          v: 1,
          score: asInt(base.score, 20, 100, 20),
          tools: asInt(base.tools, 0, 20, 0),
          tokens: tokens,
          alTokens: asInt(base.alTokens, 0, tokens, 0),
          findings: asInt(base.findings, 0, 500, 0),
          os: ["mac", "win", "linux"].includes(base.os) ? base.os : "linux"
        };
        const cleanNick = typeof nickname === "string" ? Array.from(nickname.trim()).slice(0, 20).join("") : "";
        if (cleanNick) payload.nick = cleanNick;
        return payload;
      }
      function downloadPng() {
        const canvas = document.createElement("canvas");
        canvas.width = 1200; canvas.height = 630;
        const context = canvas.getContext("2d");
        if (!context) throw new Error(data.labels.pngError);
        const accent = colors[data.grade] || colors.F;
        context.fillStyle = "#1c1c1a"; context.fillRect(0, 0, 1200, 630);
        context.strokeStyle = "#2a2a27"; context.lineWidth = 2; context.strokeRect(1, 1, 1198, 628);
        context.fillStyle = "#F7F7F5"; context.font = "700 42px system-ui, sans-serif"; context.fillText("nautli", 64, 82);
        context.textAlign = "center"; context.textBaseline = "middle";
        context.font = "800 230px system-ui, sans-serif"; context.fillText(String(data.payload.score), 520, 310);
        context.fillStyle = accent; context.font = "800 112px system-ui, sans-serif"; context.fillText(data.grade, 785, 315);
        context.textBaseline = "alphabetic"; context.fillStyle = "#a3a39e"; context.font = "500 30px system-ui, sans-serif"; context.textAlign = "left"; context.fillText(data.cardStats, 64, 560);
        context.fillStyle = "#87877f"; context.font = "700 27px system-ui, sans-serif"; context.textAlign = "right"; context.fillText("nautli.ai", 1136, 560);
        const link = document.createElement("a"); link.download = "nautli-memory-score.png"; link.href = canvas.toDataURL("image/png"); link.click();
      }
      pngButton.addEventListener("click", () => {
        try { downloadPng(); pngButton.textContent = data.labels.png; }
        catch (error) { pngButton.textContent = data.labels.pngError; status.textContent = error && error.message ? error.message : data.labels.pngError; }
      });
      shareButton.addEventListener("click", async () => {
        shareButton.disabled = true; shareButton.textContent = data.labels.sharing; status.textContent = "";
        try {
          const response = await fetch("https://nautli.ai/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(buildSharePayload(data.payload, nick.value)) });
          if (!response.ok) throw new Error(data.labels.shareError + " (HTTP " + response.status + ")");
          const body = await response.json();
          if (!body || body.ok !== true || typeof body.url !== "string") throw new Error(data.labels.shareError);
          let copied = false;
          try { await navigator.clipboard.writeText(body.url); copied = true; } catch {}
          status.textContent = copied ? data.labels.copied + ": " : data.labels.ready + ": ";
          const anchor = document.createElement("a"); anchor.href = body.url; anchor.textContent = body.url; anchor.target = "_blank"; anchor.rel = "noopener"; status.append(anchor);
          shareButton.textContent = data.labels.shareButton;
        } catch (error) {
          const message = error && error.message ? error.message : data.labels.shareError;
          shareButton.textContent = data.labels.shareError; status.textContent = message;
        } finally { shareButton.disabled = false; }
      });
    })();
  </script>
</body>
</html>`;
}

export function writeReport(result, options = {}) {
  const directory = fs.mkdtempSync(path.join(options.tmpdir ?? os.tmpdir(), "nautli-scan-"));
  const file = path.join(directory, "report.html");
  fs.writeFileSync(file, renderReportHtml(result, options), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return file;
}

export function openReport(file, platform = process.platform) {
  let command;
  let args;
  if (platform === "darwin") {
    command = "open"; args = [file];
  } else if (platform === "win32") {
    command = "explorer.exe"; args = [file];
  } else {
    command = "xdg-open"; args = [file];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export const generateReport = writeReport;
