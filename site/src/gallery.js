(() => {
  const root = document.querySelector("[data-gallery]");
  if (!root) return;

  const copy = JSON.parse(document.getElementById("gallery-copy").textContent);
  const statsNode = root.querySelector("[data-gallery-stats]");
  const statusNode = root.querySelector("[data-gallery-status]");
  const emptyNode = root.querySelector("[data-gallery-empty]");
  const wall = root.querySelector("[data-gallery-wall]");
  const tabs = [...root.querySelectorAll("[data-gallery-tab]")];
  const number = new Intl.NumberFormat(document.documentElement.lang || "en");
  let active = "recent";
  let groups = { recent: [], top: [], bottom: [] };

  function format(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
  }

  function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function cardLink(card) {
    const link = document.createElement("a");
    const grade = /^[SABCF]$/.test(card.grade) ? card.grade : "F";
    const score = Math.max(0, Math.min(100, Math.round(numeric(card.score))));
    const tools = Math.max(0, Math.round(numeric(card.tools)));
    const tokens = Math.max(0, Math.round(numeric(card.tokens)));
    const findings = Math.max(0, Math.round(numeric(card.findings)));

    link.className = "gallery-card";
    link.dataset.grade = grade;
    link.href = `/r/${encodeURIComponent(String(card.id ?? ""))}`;

    const head = document.createElement("div");
    head.className = "gallery-card-head";
    const brand = document.createElement("span");
    brand.textContent = "nautli";
    const nick = document.createElement("span");
    nick.className = "gallery-card-nick";
    nick.textContent = String(card.nick || copy.anonymous);
    head.append(brand, nick);

    const scoreNode = document.createElement("div");
    scoreNode.className = "gallery-score";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent = number.format(score);
    const gradeValue = document.createElement("span");
    gradeValue.textContent = grade;
    scoreNode.append(scoreValue, gradeValue);

    const stats = document.createElement("p");
    stats.className = "gallery-card-stats";
    stats.textContent = format(copy.cardStats, {
      tools: number.format(tools),
      tokens: number.format(tokens),
      findings: number.format(findings),
    });

    const foot = document.createElement("div");
    foot.className = "gallery-card-foot";
    const percentile = document.createElement("span");
    percentile.textContent = Number.isFinite(Number(card.percentile))
      ? format(copy.topPercent, {
          percent: number.format(Math.max(1, 100 - numeric(card.percentile))),
        })
      : "";
    const domain = document.createElement("span");
    domain.textContent = "nautli.ai";
    foot.append(percentile, domain);

    link.append(head, scoreNode, stats, foot);
    return link;
  }

  function render() {
    const cards = groups[active] || [];
    wall.replaceChildren(...cards.map(cardLink));
    emptyNode.hidden = cards.length !== 0;
    statusNode.hidden = true;
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      active = tab.dataset.galleryTab;
      for (const candidate of tabs) {
        candidate.setAttribute("aria-selected", String(candidate === tab));
      }
      render();
    });
  }

  fetch("/api/gallery", { headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error(`gallery ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      if (!payload?.ok) throw new Error("gallery response");
      groups = {
        recent: Array.isArray(payload.recent) ? payload.recent : [],
        top: Array.isArray(payload.top) ? payload.top : [],
        bottom: Array.isArray(payload.bottom) ? payload.bottom : [],
      };
      statsNode.textContent = format(copy.stats, {
        count: number.format(Math.max(0, Math.round(numeric(payload.stats?.count)))),
        avg: number.format(Math.round(numeric(payload.stats?.avg))),
      });
      render();
    })
    .catch(() => {
      statsNode.textContent = copy.error;
      statusNode.textContent = copy.error;
      statusNode.hidden = false;
      emptyNode.hidden = true;
      wall.replaceChildren();
    });
})();
