// 브라우저 표면 스캔. 파일은 전부 로컬에서 읽고 어디로도 보내지 않는다.
// 여기서 잡는 건 문자열·크기·시간 신호뿐이다. 의미 판정(두 결정이 충돌하는가)은
// 브라우저에 LLM이 없어서 구조적으로 불가능하고, 그건 설치 후 `nautli checkup`의 층이다.
// 그 경계를 UI에서 흐리면 안 된다.
(() => {
  const root = document.querySelector("[data-diagnose]");
  if (!root) return;

  const copy = JSON.parse(document.getElementById("diagnose-copy").textContent);
  const panes = {
    idle: root.querySelector("[data-pane='idle']"),
    scanning: root.querySelector("[data-pane='scanning']"),
    result: root.querySelector("[data-pane='result']"),
    error: root.querySelector("[data-pane='error']"),
  };

  const MAX_FILES = 4000;
  const MAX_BYTES = 40 * 1024 * 1024;
  const TEXT_EXT = /\.(md|markdown|mdx|txt|org)$/i;
  // 에이전트가 매 세션 통째로 읽는 파일들. 여기 붙은 용량은 대화마다 반복 지불된다.
  const ALWAYS_LOADED = /^(claude\.md|agents\.md|conventions\.md|cursorrules|\.cursorrules|copilot-instructions\.md|gemini\.md|memory\.md)$/i;

  function show(name) {
    for (const [key, node] of Object.entries(panes)) {
      if (node) node.hidden = key !== name;
    }
  }

  function text(key) {
    return copy[key] ?? key;
  }

  // 영어는 단복수가 갈리고 한국어·일본어는 안 갈린다.
  // 숫자 옆 명사를 문자열에 박아두면 "1 files"가 나온다 — 이 함수를 거쳐라.
  function word(count, key) {
    return text(count === 1 ? `word${key}One` : `word${key}Many`);
  }

  function fmt(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""));
  }

  function bytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  // 영어·한국어·일본어가 섞인 노트라 단어 수로는 못 센다.
  // 실측 대신 추정치임을 UI에서 반드시 "추정"으로 표기한다.
  function estimateTokens(source) {
    const cjk = (source.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
    return Math.round(cjk + (source.length - cjk) / 4);
  }

  function normalizeBlock(block) {
    return block
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#*_>`~\-|[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function readEntries(fileList) {
    const files = [];
    let skippedBinary = 0;
    for (const file of fileList) {
      const name = file.name || "";
      if (!TEXT_EXT.test(name)) {
        skippedBinary += 1;
        continue;
      }
      files.push(file);
    }
    return { files, skippedBinary };
  }

  async function scan(fileList, folderLabel) {
    const { files, skippedBinary } = await readEntries(fileList);
    if (!files.length) {
      showError(text("errorNoMarkdown"));
      return;
    }

    const capped = files.slice(0, MAX_FILES);
    const partial = capped.length < files.length;

    show("scanning");
    const progress = panes.scanning.querySelector("[data-progress]");

    const docs = [];
    let totalBytes = 0;
    let bytesBudgetHit = false;

    for (let i = 0; i < capped.length; i += 1) {
      const file = capped[i];
      if (totalBytes + file.size > MAX_BYTES) {
        bytesBudgetHit = true;
        break;
      }
      let body = "";
      try {
        body = await file.text();
      } catch {
        continue;
      }
      totalBytes += file.size;
      docs.push({
        path: file.webkitRelativePath || file.name,
        name: file.name,
        size: file.size,
        modified: file.lastModified || 0,
        body,
      });
      if (i % 25 === 0) {
        progress.textContent = fmt(text("scanningProgress"), { done: i + 1, total: capped.length });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    render(analyze(docs), {
      folderLabel,
      totalBytes,
      skippedBinary,
      partial: partial || bytesBudgetHit,
      scanned: docs.length,
    });
  }

  function analyze(docs) {
    const findings = [];

    // 1. 상시 로드 파일 — 가장 확도 높은 신호다. 크기가 곧 반복 비용이다.
    const alwaysLoaded = docs
      .filter((d) => ALWAYS_LOADED.test(d.name))
      .map((d) => ({ ...d, tokens: estimateTokens(d.body) }))
      .sort((a, b) => b.tokens - a.tokens);

    for (const doc of alwaysLoaded) {
      if (doc.tokens < 1500) continue;
      findings.push({
        group: "alwaysLoaded",
        weight: doc.tokens > 6000 ? 3 : 2,
        title: fmt(text("findAlwaysLoadedTitle"), { name: doc.name }),
        measure: fmt(text("findAlwaysLoadedMeasure"), {
          tokens: doc.tokens.toLocaleString(),
          size: bytes(doc.size),
        }),
        why: text("findAlwaysLoadedWhy"),
        files: [doc.path],
      });
    }

    // 2. 반복 문단 — 같은 문장을 여러 파일에 복사해 둔 흔적.
    const blocks = new Map();
    for (const doc of docs) {
      const seenInDoc = new Set();
      for (const raw of doc.body.split(/\n\s*\n/)) {
        const norm = normalizeBlock(raw);
        if (norm.length < 80) continue;
        if (seenInDoc.has(norm)) continue;
        seenInDoc.add(norm);
        if (!blocks.has(norm)) blocks.set(norm, { sample: raw.trim(), where: [] });
        blocks.get(norm).where.push(doc.path);
      }
    }
    const repeated = [...blocks.values()]
      .filter((b) => b.where.length > 1)
      .sort((a, b) => b.where.length - a.where.length);

    for (const block of repeated.slice(0, 12)) {
      findings.push({
        group: "repeated",
        weight: block.where.length >= 4 ? 3 : 2,
        title: fmt(text("findRepeatedTitle"), {
          count: block.where.length,
          fileWord: word(block.where.length, "File"),
        }),
        measure: fmt(text("findRepeatedMeasure"), { chars: block.sample.length }),
        why: text("findRepeatedWhy"),
        files: block.where,
        snippet: block.sample.slice(0, 400),
      });
    }

    // 3. 거대 단일 파일
    for (const doc of [...docs].sort((a, b) => b.size - a.size).slice(0, 3)) {
      if (doc.size < 60 * 1024) continue;
      findings.push({
        group: "large",
        weight: 1,
        title: fmt(text("findLargeTitle"), { name: doc.name }),
        measure: fmt(text("findLargeMeasure"), {
          size: bytes(doc.size),
          tokens: estimateTokens(doc.body).toLocaleString(),
        }),
        why: text("findLargeWhy"),
        files: [doc.path],
      });
    }

    // 4. 빈 파일
    const empties = docs.filter((d) => d.body.trim().length < 20);
    if (empties.length) {
      findings.push({
        group: "debris",
        weight: 1,
        title: fmt(text("findEmptyTitle"), {
          count: empties.length,
          fileWord: word(empties.length, "File"),
        }),
        measure: fmt(text("findEmptyMeasure"), { count: empties.length }),
        why: text("findEmptyWhy"),
        files: empties.map((d) => d.path).slice(0, 20),
      });
    }

    // 5. TODO/FIXME 잔해
    let todoHits = 0;
    const todoFiles = [];
    for (const doc of docs) {
      const hits = (doc.body.match(/\b(TODO|FIXME|XXX|WIP)\b/g) || []).length;
      if (hits) {
        todoHits += hits;
        todoFiles.push(doc.path);
      }
    }
    if (todoHits >= 5) {
      findings.push({
        group: "debris",
        weight: 1,
        title: fmt(text("findTodoTitle"), {
          count: todoHits,
          markerWord: word(todoHits, "Marker"),
        }),
        measure: fmt(text("findTodoMeasure"), {
          files: todoFiles.length,
          fileWord: word(todoFiles.length, "File"),
        }),
        why: text("findTodoWhy"),
        files: todoFiles.slice(0, 20),
      });
    }

    // 6. 오래 안 고친 파일 — 오래됐다는 사실만으로는 문제가 아니다. 점수에 넣지 않는다.
    const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const stale = docs.filter((d) => d.modified && d.modified < yearAgo);
    if (stale.length) {
      findings.push({
        group: "stale",
        weight: 0,
        title: fmt(text("findStaleTitle"), {
          count: stale.length,
          fileWord: word(stale.length, "File"),
        }),
        measure: fmt(text("findStaleMeasure"), {
          count: stale.length,
          fileWord: word(stale.length, "File"),
        }),
        why: text("findStaleWhy"),
        files: stale.map((d) => d.path).slice(0, 20),
      });
    }

    return { docs, findings, alwaysLoaded, repeated };
  }

  function scoreOf(findings) {
    // 확도 높은 신호만 점수에 반영한다(weight 0인 노후 파일은 제외).
    const penalty = findings.reduce((sum, f) => sum + f.weight * 4, 0);
    return Math.max(20, 100 - Math.min(penalty, 80));
  }

  function el(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  function findingCard(finding) {
    const card = el("article", "dg-finding");
    card.append(el("p", "dg-finding-measure", finding.measure));
    card.append(el("h3", null, finding.title));
    card.append(el("p", "dg-finding-why", finding.why));

    const details = el("details", "dg-evidence");
    const summary = el("summary", null, fmt(text("evidenceToggle"), { count: finding.files.length }));
    details.append(summary);
    const list = el("ul", "dg-file-list");
    for (const file of finding.files.slice(0, 12)) list.append(el("li", null, file));
    if (finding.files.length > 12) {
      list.append(el("li", "dg-more", fmt(text("evidenceMore"), { count: finding.files.length - 12 })));
    }
    details.append(list);
    // 본문 스니펫은 기본 접힘. 화면 공유 중 사적인 내용이 바로 노출되면 안 된다.
    if (finding.snippet) details.append(el("pre", "dg-snippet", finding.snippet));
    card.append(details);
    return card;
  }

  function render(analysis, meta) {
    const { findings } = analysis;
    const counted = findings.filter((f) => f.weight > 0);
    const affected = new Set(findings.flatMap((f) => f.files)).size;
    const out = panes.result;
    out.textContent = "";

    out.append(el("p", "dg-eyebrow", fmt(text("resultEyebrow"), { folder: meta.folderLabel })));

    // 맨 위는 점수가 아니라 "검토할 신호 수 / 영향 파일 수"다.
    // 점수를 주인공으로 만들면 숫자만 보고 지나간다.
    const lede = el("div", "dg-lede");
    lede.append(el("strong", null, String(counted.length)));
    lede.append(el("span", null, fmt(text("resultSignals"), {
      affected,
      scanned: meta.scanned,
      signalWord: word(counted.length, "Signal"),
      fileWord: word(meta.scanned, "File"),
    })));
    out.append(lede);

    const meta2 = el("p", "dg-meta", fmt(text("resultMeta"), {
      scanned: meta.scanned,
      size: bytes(meta.totalBytes),
      skipped: meta.skippedBinary,
      fileWord: word(meta.scanned, "File"),
      skippedWord: word(meta.skippedBinary, "File"),
    }));
    out.append(meta2);

    if (meta.partial) out.append(el("p", "dg-warn", text("resultPartial")));

    if (!counted.length) {
      out.append(el("p", "dg-clean", text("resultClean")));
    } else {
      const top = el("div", "dg-findings");
      for (const finding of [...findings].sort((a, b) => b.weight - a.weight).slice(0, 3)) {
        top.append(findingCard(finding));
      }
      out.append(top);

      const rest = findings.slice(3);
      if (rest.length) {
        const more = el("details", "dg-rest");
        more.append(el("summary", null, fmt(text("restToggle"), { count: rest.length })));
        const wrap = el("div", "dg-findings");
        for (const finding of rest) wrap.append(findingCard(finding));
        more.append(wrap);
        out.append(more);
      }
    }

    // 표면 점수는 부분 스캔에서 만들지 않는다.
    if (!meta.partial && counted.length) {
      const score = scoreOf(counted);
      const scoreBox = el("div", "dg-score");
      scoreBox.append(el("span", "dg-score-label", text("scoreLabel")));
      scoreBox.append(el("strong", null, String(score)));
      scoreBox.append(el("span", "dg-score-note", text("scoreNote")));
      out.append(scoreBox);
    }

    // 경계 고지 → 그 다음에야 설치 제안. 순서를 바꾸면 과장이 된다.
    const boundary = el("div", "dg-boundary");
    boundary.append(el("h3", null, text("boundaryTitle")));
    boundary.append(el("p", null, text("boundaryBody")));
    out.append(boundary);

    const cta = el("div", "dg-cta");
    cta.append(el("h3", null, counted.length ? text("ctaTitle") : text("ctaTitleClean")));
    cta.append(el("p", null, text("ctaBody")));
    const link = el("a", "dg-cta-button", text("ctaButton"));
    link.href = root.dataset.installHref;
    cta.append(link);
    cta.append(el("p", "dg-cta-note", text("ctaNote")));
    out.append(cta);

    show("result");
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(message) {
    panes.error.querySelector("[data-error-message]").textContent = message;
    show("error");
  }

  async function pickWithDirectoryPicker() {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    const files = [];
    async function walk(dir, prefix) {
      for await (const entry of dir.values()) {
        const next = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          if (/^(node_modules|\.git|\.obsidian|\.trash)$/i.test(entry.name)) continue;
          await walk(entry, next);
        } else if (TEXT_EXT.test(entry.name)) {
          const file = await entry.getFile();
          Object.defineProperty(file, "webkitRelativePath", { value: next });
          files.push(file);
        }
        if (files.length > MAX_FILES) return;
      }
    }
    await walk(handle, "");
    return { files, label: handle.name };
  }

  root.querySelector("[data-action='pick']")?.addEventListener("click", async () => {
    try {
      if (window.showDirectoryPicker) {
        const { files, label } = await pickWithDirectoryPicker();
        await scan(files, label);
        return;
      }
      // Safari·Firefox 폴백: webkitdirectory input.
      root.querySelector("[data-fallback-input]")?.click();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      showError(error?.message || text("errorGeneric"));
    }
  });

  root.querySelector("[data-fallback-input]")?.addEventListener("change", async (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    const label = files[0].webkitRelativePath?.split("/")[0] || text("folderFallbackLabel");
    try {
      await scan(files, label);
    } catch (error) {
      showError(error?.message || text("errorGeneric"));
    }
  });

  root.querySelector("[data-action='reset']")?.addEventListener("click", () => show("idle"));

  if (!window.showDirectoryPicker && !("webkitdirectory" in document.createElement("input"))) {
    root.querySelector("[data-unsupported]")?.removeAttribute("hidden");
  }
})();
