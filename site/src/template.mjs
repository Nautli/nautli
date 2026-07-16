const githubUrl = "https://github.com/Nautli/nautli";
const discordUrl = "https://discord.gg/nautli";
const formulaUrl = `${githubUrl}/blob/main/docs/checkup-score.md`;

const pageFiles = {
  index: "",
  manifesto: "manifesto.html",
  install: "install.html",
  faq: "faq.html",
  c: "c/",
};

export function pagePath(locale, page) {
  const prefix = locale === "en" ? "/" : `/${locale}/`;
  return `${prefix}${pageFiles[page]}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function externalLink(href, label, className = "") {
  return `<a${className ? ` class="${className}"` : ""} href="${href}" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function githubIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.58 9.58 0 0 1 12 6.82a9.5 9.5 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>`;
}

function discordIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.5 5.34A17.2 17.2 0 0 0 15.44 4l-.5 1.02a15.9 15.9 0 0 0-5.86 0L8.56 4A17.3 17.3 0 0 0 4.5 5.35C1.93 9.16 1.23 12.88 1.58 16.54a17.1 17.1 0 0 0 4.98 2.52l1.2-1.64a11.1 11.1 0 0 1-1.9-.91l.47-.37a12.3 12.3 0 0 0 11.34 0l.47.37c-.6.36-1.24.66-1.9.9l1.2 1.65a17 17 0 0 0 4.98-2.52c.41-4.24-.7-7.93-2.92-11.2ZM8.5 14.3c-1.1 0-2-1.02-2-2.27 0-1.25.88-2.28 2-2.28s2.02 1.03 2 2.28c0 1.25-.88 2.27-2 2.27Zm7 0c-1.1 0-2-1.02-2-2.27 0-1.25.88-2.28 2-2.28s2.02 1.03 2 2.28c0 1.25-.88 2.27-2 2.27Z"/></svg>`;
}

function languageMenu(locale, page, copy) {
  const labels = { en: "English", ko: "한국어", ja: "日本語" };
  return `<div class="language-picker">
    <button class="icon-text-button language-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="language-menu">🌐 ${labels[locale]}</button>
    <div class="language-menu" id="language-menu" role="menu" hidden>
      ${Object.entries(labels).map(([code, label]) => `<a role="menuitem" lang="${code}" hreflang="${code}" href="${pagePath(code, page)}"${code === locale ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </div>
  </div>`;
}

function nav(locale, page, copy) {
  return `<header class="site-header">
    <div class="site-header-inner">
      <a class="wordmark" href="${pagePath(locale, "index")}" aria-label="nautli ${escapeHtml(copy.common.home)}">nautli</a>
      <nav class="primary-links" aria-label="${escapeHtml(copy.common.primaryNav)}">
        <a class="text-nav" href="${pagePath(locale, "manifesto")}"${page === "manifesto" ? ' aria-current="page"' : ""}>${escapeHtml(copy.common.manifesto)}</a>
        <a class="text-nav" href="${pagePath(locale, "install")}"${page === "install" ? ' aria-current="page"' : ""}>${escapeHtml(copy.common.install)}</a>
        <a class="icon-link" href="${githubUrl}" aria-label="GitHub" rel="noreferrer">${githubIcon()}</a>
        <a class="icon-link" href="${discordUrl}" aria-label="Discord" rel="noreferrer">${discordIcon()}</a>
        ${languageMenu(locale, page, copy)}
        <button class="theme-button" type="button" aria-label="${escapeHtml(copy.common.themeToDark)}" data-light-label="${escapeHtml(copy.common.themeToLight)}" data-dark-label="${escapeHtml(copy.common.themeToDark)}">☾</button>
      </nav>
    </div>
  </header>`;
}

function footer(locale, copy) {
  return `<footer class="site-footer shell">
    <div><a class="wordmark" href="${pagePath(locale, "index")}">nautli</a><span>${escapeHtml(copy.common.license)}</span></div>
    <nav aria-label="${escapeHtml(copy.common.footerNav)}">
      <a href="${githubUrl}" rel="noreferrer">GitHub</a>
      <a href="${discordUrl}" rel="noreferrer">Discord</a>
      <a href="${pagePath(locale, "faq")}">${escapeHtml(copy.common.faq)}</a>
      <span>EN · KO · JA</span>
    </nav>
  </footer>`;
}

function commandBlock(commands, copy, className = "") {
  return `<div class="command-block${className ? ` ${className}` : ""}">
    ${commands.map((command, index) => `<div class="command-row">
      <code id="command-${escapeHtml(command.id ?? index)}">${escapeHtml(command.text ?? command)}</code>
      <button class="copy-button" type="button" data-copy="${escapeHtml(command.text ?? command)}" aria-describedby="copy-status-${escapeHtml(command.id ?? index)}">${escapeHtml(copy.common.copy)}</button>
      <span class="copy-status" id="copy-status-${escapeHtml(command.id ?? index)}" role="status" aria-live="polite"></span>
    </div>`).join("")}
    ${commands.length > 1 ? `<div class="copy-all-row"><button class="secondary-button copy-button" type="button" data-copy="${escapeHtml(commands.map((command) => command.text ?? command).join("\n"))}" aria-describedby="copy-status-all">${escapeHtml(copy.common.copyAll)}</button><span class="copy-status" id="copy-status-all" role="status" aria-live="polite"></span></div>` : ""}
  </div>`;
}

function sectionLabel(text) {
  return `<p class="section-label">${escapeHtml(text)}</p>`;
}

function homePage(locale, copy) {
  const h = copy.home;
  const commands = h.commands.map((text, index) => ({ text, id: `home-${index}` }));
  return `<main>
    <section class="hero shell wide-shell">
      <svg class="spiral" viewBox="0 0 300 300" aria-hidden="true"><path d="M150 38C209 43 251 100 246 150C241 200 192 235 150 230C108 225 81 184 86 150C91 116 125 97 150 102C175 107 187 133 182 150C177 167 160 175 150 170C142 166 140 153 150 150" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(h.eyebrow)}</p>
        <h1>${escapeHtml(h.h1)}</h1>
        <p class="hero-subline">${escapeHtml(h.subline)}</p>
      </div>
      ${commandBlock(commands, copy, "hero-commands")}
      <p class="trust-line">🔒 ${escapeHtml(h.trustLine)}</p>
    </section>

    <section class="creed-banner">
      <div class="shell wide-shell creed-inner">
        <div><h2 lang="en">Your memory outlives every model.</h2><p>${escapeHtml(h.creedLocal)}</p></div>
        <a href="${pagePath(locale, "manifesto")}">→ ${escapeHtml(copy.common.manifesto)}</a>
      </div>
    </section>

    <section class="section shell wide-shell">
      ${sectionLabel(h.boundaryLabel)}
      <h2>${escapeHtml(h.boundaryTitle)}</h2>
      <div class="boundary-grid">
        ${h.boundaries.map((item) => `<article class="boundary-card"><h3>${escapeHtml(item.title)}</h3><ul>${item.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>${item.link ? `<a href="${item.link.href}" rel="noreferrer">${escapeHtml(item.link.label)}</a>` : ""}</article>`).join("")}
      </div>
    </section>

    <section class="section shell wide-shell">
      ${sectionLabel(h.trustLabel)}
      <h2>${escapeHtml(h.trustTitle)}</h2>
      <div class="card-grid trust-grid">
        ${h.trustCards.map((card) => `<article class="card"><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.body)}</p><code class="verify-command">${escapeHtml(card.command)}</code><a class="plain-link" href="${card.href}" rel="noreferrer">${escapeHtml(card.link)}</a></article>`).join("")}
      </div>
      <div class="fact-example">
        <p>${escapeHtml(h.factIntro)}</p>
        <dl>${h.fact.map((row) => `<div><dt><code>${escapeHtml(row.key)}</code></dt><dd><code>${escapeHtml(row.value)}</code></dd></div>`).join("")}</dl>
      </div>
    </section>

    <section class="section shell wide-shell">
      ${sectionLabel(h.howLabel)}
      <h2>${escapeHtml(h.howTitle)}</h2>
      <p class="section-intro">${escapeHtml(h.howIntro)}</p>
      <div class="conversation-grid">
        <article class="conversation"><h3>${escapeHtml(h.beforeTitle)}</h3>${h.before.map((line) => `<p><strong>${escapeHtml(line.speaker)}</strong> ${escapeHtml(line.text)}</p>`).join("")}</article>
        <article class="conversation after"><h3>${escapeHtml(h.afterTitle)}</h3>${h.after.map((line) => `<p${line.added ? ' class="added"' : ""}><strong>${escapeHtml(line.speaker)}</strong> ${escapeHtml(line.text)}</p>`).join("")}</article>
      </div>
    </section>

    <section class="section shell wide-shell">
      ${sectionLabel(h.checkLabel)}
      <h2>${escapeHtml(h.checkTitle)}</h2>
      <p class="section-intro">${escapeHtml(h.checkIntro)}</p>
      <article class="empty-card"><p>${escapeHtml(h.emptyState)}</p><code>nautli checkup ~/notes</code></article>
      <div class="review-grid">
        ${h.reviews.map((review) => `<article class="review-card"><p class="review-type">${escapeHtml(review.type)}</p><h3>${escapeHtml(review.title)}</h3><p>${escapeHtml(review.body)}</p><p class="review-note">${escapeHtml(review.note)}</p></article>`).join("")}
      </div>
      <a class="formula-link" href="${formulaUrl}" rel="noreferrer">→ ${escapeHtml(h.formula)}</a>
    </section>

    <section class="section shell wide-shell">
      ${sectionLabel(h.compareLabel)}
      <h2>${escapeHtml(h.compareTitle)}</h2>
      <div class="table-wrap"><table><thead><tr>${h.compareHeaders.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${h.compareRows.map((row) => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    </section>

    <section class="section shell wide-shell community-grid">
      <article class="community-block"><h2>${escapeHtml(h.supporterTitle)}</h2><p>${escapeHtml(h.supporterBody)}</p>${externalLink("https://github.com/sponsors/Nautli", h.supporterLink, "secondary-button")}</article>
      <article class="community-block"><h2>${escapeHtml(h.discordTitle)}</h2><p>${escapeHtml(h.discordBody)}</p>${externalLink(discordUrl, h.discordLink, "secondary-button")}</article>
    </section>
  </main>`;
}

function manifestoPage(copy) {
  const m = copy.manifesto;
  return `<main class="subpage shell">
    <section class="manifesto-lead"><p class="eyebrow">${escapeHtml(m.eyebrow)}</p><h1 lang="en">Your memory outlives every model.</h1><p class="creed-translation">${escapeHtml(m.creedLocal)}</p></section>
    <section class="section">
      ${sectionLabel(m.tableLabel)}
      <div class="table-wrap"><table><thead><tr><th scope="col">${escapeHtml(m.doTitle)}</th><th scope="col">${escapeHtml(m.dontTitle)}</th></tr></thead><tbody>${m.rows.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td></tr>`).join("")}</tbody></table></div>
    </section>
    <article class="essay">${m.essay.map((paragraph, index) => index === 0 ? `<h2>${escapeHtml(paragraph)}</h2>` : `<p>${escapeHtml(paragraph)}</p>`).join("")}</article>
  </main>`;
}

function installPage(copy) {
  const i = copy.install;
  const commands = i.commands.map((text, index) => ({ text, id: `install-${index}` }));
  return `<main class="subpage shell">
    <header class="subpage-lead"><p class="eyebrow">${escapeHtml(i.eyebrow)}</p><h1>${escapeHtml(i.title)}</h1><p>${escapeHtml(i.intro)}</p></header>
    <section class="section">${sectionLabel(i.requirementsLabel)}<div class="table-wrap"><table><tbody>${i.requirements.map((row) => `<tr><th scope="row">${escapeHtml(row[0])}</th><td>${escapeHtml(row[1])}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="section">${sectionLabel(i.commandsLabel)}<h2>${escapeHtml(i.commandsTitle)}</h2>${commandBlock(commands, copy, "install-commands")}</section>
    <section class="section">${sectionLabel(i.changesLabel)}<h2>${escapeHtml(i.changesTitle)}</h2><div class="table-wrap"><table><thead><tr><th scope="col">${escapeHtml(i.fileHeader)}</th><th scope="col">${escapeHtml(i.changeHeader)}</th><th scope="col">${escapeHtml(i.undoHeader)}</th></tr></thead><tbody>${i.changes.map((row) => `<tr><th scope="row"><code>${escapeHtml(row[0])}</code></th><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td></tr>`).join("")}</tbody></table></div><p class="small-note">${escapeHtml(i.undoNote)}</p></section>
    <section class="section test-block">${sectionLabel(i.testLabel)}<h2>${escapeHtml(i.testTitle)}</h2><code>nautli checkup ./empty-test</code><p>${escapeHtml(i.testBody)}</p></section>
    <section class="section help-block"><h2>${escapeHtml(i.helpTitle)}</h2><p>${escapeHtml(i.helpBody)}</p><p><a href="${githubUrl}/issues" rel="noreferrer">GitHub Issues</a> · <a href="${discordUrl}" rel="noreferrer">Discord</a></p></section>
  </main>`;
}

function faqPage(copy) {
  const f = copy.faq;
  return `<main class="subpage shell"><header class="subpage-lead"><p class="eyebrow">${escapeHtml(f.eyebrow)}</p><h1>${escapeHtml(f.title)}</h1><p>${escapeHtml(f.intro)}</p></header><section class="faq-list">${f.items.map((item, index) => `<details${index === 0 ? " open" : ""}><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join("")}</section></main>`;
}

function sharePage(copy) {
  const s = copy.share;
  const commands = s.commands.map((text, index) => ({ text, id: `share-${index}` }));
  return `<main class="share-page">
    <section class="share-result-panel">
      <div class="share-empty" id="share-empty"><p class="section-label">${escapeHtml(s.emptyLabel)}</p><h1>${escapeHtml(s.emptyTitle)}</h1><p>${escapeHtml(s.emptyBody)}</p></div>
      <div class="share-result" id="share-result" hidden>
        <p class="section-label">${escapeHtml(s.resultLabel)}</p><h1>${escapeHtml(s.title)}</h1>
        <div class="score-line"><strong data-share-value="score">0</strong><span>${escapeHtml(s.scoreSuffix)}</span></div>
        <dl class="share-metrics">${s.metrics.map((metric) => `<div><dt>${escapeHtml(metric.label)}</dt><dd data-share-value="${escapeHtml(metric.key)}">0</dd></div>`).join("")}</dl>
        <p class="share-note">${escapeHtml(s.resultNote)}</p>
      </div>
    </section>
    <section class="share-turn-panel"><div><p class="section-label">${escapeHtml(s.turnLabel)}</p><h2>${escapeHtml(s.turnTitle)}</h2><p>${escapeHtml(s.turnBody)}</p>${commandBlock(commands, copy, "share-commands")}</div></section>
  </main>`;
}

function pageContent(locale, page, copy) {
  if (page === "index") return homePage(locale, copy);
  if (page === "manifesto") return manifestoPage(copy);
  if (page === "install") return installPage(copy);
  if (page === "faq") return faqPage(copy);
  return sharePage(copy);
}

export function renderPage({ locale, page, copy, baseUrl }) {
  const meta = copy.meta[page];
  const canonical = `${baseUrl}${pagePath(locale, page)}`;
  const alternateLinks = [
    ...["en", "ko", "ja"].map((code) => `<link rel="alternate" hreflang="${code}" href="${baseUrl}${pagePath(code, page)}">`),
    `<link rel="alternate" hreflang="x-default" href="${baseUrl}${pagePath("en", page)}">`,
  ].join("\n  ");
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "nautli",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS",
    description: meta.description,
    url: canonical,
    license: `${githubUrl}/blob/main/LICENSE`,
    softwareHelp: `${baseUrl}${pagePath(locale, "faq")}`,
  };
  const bodyClass = page === "c" ? "share-body" : "";
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeHtml(meta.description)}">
  <link rel="canonical" href="${canonical}">
  ${alternateLinks}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="nautli">
  <meta property="og:title" content="${escapeHtml(meta.title)}">
  <meta property="og:description" content="${escapeHtml(meta.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="/assets/og.png">
  <meta property="og:locale" content="${escapeHtml(copy.ogLocale)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="alternate icon" href="/assets/favicon.ico">
  <link rel="stylesheet" href="/style.css">
  <script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>
  <script src="/main.js" defer></script>
</head>
<body class="${bodyClass}" data-page="${page}" data-copy-success="${escapeHtml(copy.common.copySuccess)}" data-copy-failure="${escapeHtml(copy.common.copyFailure)}" data-copy-prompt="${escapeHtml(copy.common.copyPrompt)}">
  <a class="skip-link" href="#main-content">${escapeHtml(copy.common.skip)}</a>
  ${nav(locale, page, copy)}
  <div id="main-content">${pageContent(locale, page, copy)}</div>
  ${page === "c" ? "" : footer(locale, copy)}
</body>
</html>
`;
}
