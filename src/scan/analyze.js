import path from "node:path";

const TOOL_ORDER = [
  "claude-code",
  "codex",
  "cursor",
  "copilot",
  "gemini",
  "windsurf",
  "cline",
  "obsidian",
  "project",
];

const ALWAYS_LOADED = /^(CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|\.clinerules|copilot-instructions\.md|MEMORY\.md)$/iu;

const COPY = Object.freeze({
  en: {
    alwaysTitle: (name) => `${name} is loaded every session`,
    alwaysMeasure: (tokens) => `About ${tokens.toLocaleString("en")} tokens always loaded`,
    alwaysWhy: "Every session pays this context cost before useful work begins.",
    crossTitle: (tools) => `The same rule lives separately in ${tools.join(" and ")}`,
    crossMeasure: (files) => `One normalized paragraph appears in ${files} files`,
    crossWhy: "Copies across tools drift independently and make updates easy to miss.",
    repeatedTitle: (count, tool) => `The same paragraph is repeated in ${count} ${tool} files`,
    repeatedMeasure: (chars) => `${chars.toLocaleString("en")} source characters repeated`,
    repeatedWhy: "One shared source would be cheaper and less likely to drift.",
    largeTitle: (name) => `${name} is unusually large`,
    largeMeasure: (size, tokens) => `${formatBytes(size)} · about ${tokens.toLocaleString("en")} tokens`,
    largeWhy: "Large memory files are harder to keep focused and cheap to reload.",
    emptyTitle: (count) => `${count} nearly empty memory files`,
    emptyMeasure: (count) => `${count} files contain 20 characters or fewer`,
    emptyWhy: "Empty remnants add search noise without carrying useful memory.",
    todoTitle: (count) => `${count} unfinished markers remain`,
    todoMeasure: (files) => `Found across ${files} files`,
    todoWhy: "Old TODO, FIXME, XXX, and WIP markers blur current instructions.",
    staleTitle: (count) => `${count} files have not changed for a year`,
    staleMeasure: (count) => `${count} older files, excluded from the score`,
    staleWhy: "Age alone is not a defect, so this is shown only for review.",
  },
  ko: {
    alwaysTitle: (name) => `${name}가 세션마다 상시 로드됩니다`,
    alwaysMeasure: (tokens) => `상시 로드 약 ${tokens.toLocaleString("ko")}토큰`,
    alwaysWhy: "실제 작업을 시작하기 전에 매 세션 같은 컨텍스트 비용을 냅니다.",
    crossTitle: (tools) => `같은 규칙이 ${tools.join("와 ")}에 따로 삽니다`,
    crossMeasure: (files) => `정규화한 같은 문단이 ${files}개 파일에 있습니다`,
    crossWhy: "도구마다 둔 복사본은 따로 낡아 업데이트가 빠지기 쉽습니다.",
    repeatedTitle: (count, tool) => `같은 문단이 ${tool} 파일 ${count}개에 반복됩니다`,
    repeatedMeasure: (chars) => `원문 ${chars.toLocaleString("ko")}자가 반복됩니다`,
    repeatedWhy: "하나의 정본을 공유하면 재로드 비용과 내용 불일치를 줄일 수 있습니다.",
    largeTitle: (name) => `${name}가 유난히 큽니다`,
    largeMeasure: (size, tokens) => `${formatBytes(size)} · 약 ${tokens.toLocaleString("ko")}토큰`,
    largeWhy: "큰 기억 파일은 초점을 유지하기 어렵고 재로드 비용도 큽니다.",
    emptyTitle: (count) => `거의 빈 기억 파일 ${count}개`,
    emptyMeasure: (count) => `${count}개 파일이 20자 이하입니다`,
    emptyWhy: "빈 잔해는 유용한 기억 없이 탐색 잡음만 늘립니다.",
    todoTitle: (count) => `미완료 표식 ${count}개가 남았습니다`,
    todoMeasure: (files) => `${files}개 파일에서 발견`,
    todoWhy: "오래된 TODO, FIXME, XXX, WIP 표식은 현재 지시를 흐립니다.",
    staleTitle: (count) => `1년 넘게 바뀌지 않은 파일 ${count}개`,
    staleMeasure: (count) => `오래된 파일 ${count}개, 점수에서는 제외`,
    staleWhy: "오래됐다는 사실만으로 문제는 아니므로 검토 정보로만 표시합니다.",
  },
  ja: {
    alwaysTitle: (name) => `${name}は毎セッション読み込まれます`,
    alwaysMeasure: (tokens) => `常時読み込み 約${tokens.toLocaleString("ja")}トークン`,
    alwaysWhy: "実際の作業を始める前に、毎セッション同じコンテキストコストを払っています。",
    crossTitle: (tools) => `同じルールが${tools.join("と")}に別々に存在します`,
    crossMeasure: (files) => `正規化した同一の段落が${files}件のファイルにあります`,
    crossWhy: "ツールごとのコピーは別々に古くなり、更新漏れが起きやすくなります。",
    repeatedTitle: (count, tool) => `同じ段落が${tool}のファイル${count}件で繰り返されています`,
    repeatedMeasure: (chars) => `原文${chars.toLocaleString("ja")}文字が繰り返されています`,
    repeatedWhy: "1つの原本を共有すれば、再読み込みコストと内容のずれを減らせます。",
    largeTitle: (name) => `${name}が通常よりかなり大きいです`,
    largeMeasure: (size, tokens) => `${formatBytes(size)} · 約${tokens.toLocaleString("ja")}トークン`,
    largeWhy: "大きな記憶ファイルは焦点を保ちにくく、再読み込みコストも高くつきます。",
    emptyTitle: (count) => `ほぼ空の記憶ファイルが${count}件`,
    emptyMeasure: (count) => `${count}件のファイルが20文字以下です`,
    emptyWhy: "空の残骸は有用な記憶を持たないまま、検索ノイズだけを増やします。",
    todoTitle: (count) => `未完了マーカーが${count}件残っています`,
    todoMeasure: (files) => `${files}件のファイルで発見`,
    todoWhy: "古いTODO、FIXME、XXX、WIPマーカーは現在の指示を曖昧にします。",
    staleTitle: (count) => `1年以上変更されていないファイルが${count}件`,
    staleMeasure: (count) => `古いファイル${count}件、スコアからは除外`,
    staleWhy: "古いこと自体は欠陥ではないため、確認用の情報としてのみ表示します。",
  },
});

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function estimateTokens(source) {
  const text = String(source ?? "");
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/gu) || []).length;
  return Math.round(cjk + (text.length - cjk) / 4);
}

export function normalizeBlock(block) {
  return String(block ?? "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[#*_>`~\-|[\]()]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function gradeForScore(score) {
  if (score >= 90) return "S";
  if (score >= 78) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "F";
}

/** @deprecated v1 scoring — kept only for external callers during migration. */
export function scoreForFindings(findings) {
  const penalty = findings.reduce((sum, finding) => sum + finding.weight * 4, 0);
  return Math.max(20, 100 - Math.min(80, penalty));
}

/* ── v2 scoring helpers ─────────────────────────────────────────────── */

function clamp01(x) { return Math.min(1, Math.max(0, x)); }

const LN_64K = Math.log(64_000);
const LN_2K  = Math.log(2_000);

function subFixedCost(alTokens) {
  return 100 * clamp01((LN_64K - Math.log(Math.max(alTokens, 2_000))) / (LN_64K - LN_2K));
}

function subWaste(docs, blocks) {
  const totalTok = docs.reduce((s, d) => s + d.tokens, 0);
  if (totalTok === 0) return 100;

  // duplicate portion: (n-1) × blockTokens for non-suppressed blocks with n≥2 same-tool copies
  let dupTok = 0;
  for (const block of blocks.values()) {
    if (block.suppressed) continue;
    const toolCounts = new Map();
    for (const doc of block.docs) {
      toolCounts.set(doc.tool, (toolCounts.get(doc.tool) || 0) + 1);
    }
    const blockTok = estimateTokens(block.sample);
    for (const count of toolCounts.values()) {
      if (count >= 2) dupTok += (count - 1) * blockTok;
    }
    // cross-tool duplicates also count
    const tools = [...toolCounts.keys()];
    if (tools.length >= 2) {
      dupTok += (tools.length - 1) * blockTok;
    }
  }

  // large excess: per-file tokens above 20K threshold
  let largeTok = 0;
  const LARGE_THRESHOLD = 20_000;
  for (const doc of docs) {
    if (doc.tokens > LARGE_THRESHOLD) {
      largeTok += doc.tokens - LARGE_THRESHOLD;
    }
  }

  const R = (dupTok + largeTok) / totalTok;
  return 100 * (1 - Math.min(1, R / 0.40));
}

function subHygiene(docs) {
  if (docs.length === 0) return 100;
  const emptyCount = docs.filter(d => d.body.trim().length <= 20).length;
  let todoFileCount = 0;
  for (const doc of docs) {
    if (/\b(TODO|FIXME|XXX|WIP)\b/gu.test(doc.body)) todoFileCount++;
  }
  const emptyRatio = emptyCount / docs.length;
  const todoRatio = todoFileCount / docs.length;
  return 100 * (1 - Math.min(1, emptyRatio / 0.10 + todoRatio / 0.50));
}

function computeScore(docs, blocks) {
  const alTokens = docs.filter(d => ALWAYS_LOADED.test(d.name)).reduce((s, d) => s + d.tokens, 0);
  const sFixed = subFixedCost(alTokens);
  const sWaste = subWaste(docs, blocks);
  const sHygiene = subHygiene(docs);
  const total = 0.45 * sFixed + 0.45 * sWaste + 0.10 * sHygiene;
  return { score: Math.round(total), sFixed: Math.round(sFixed), sWaste: Math.round(sWaste), sHygiene: Math.round(sHygiene) };
}

function severityFromDelta(delta) {
  if (delta >= 5) return "HIGH";
  if (delta >= 1) return "MED";
  if (delta > 0) return "LOW";
  return "INFO";
}

/**
 * Simulate resolving a finding and return the resulting score.
 * This modifies nothing — it creates virtual docs/blocks for re-scoring.
 */
function simulateFix(docs, blocks, finding) {
  const filePaths = new Set(finding.files || []);

  if (finding.group === "alwaysLoaded") {
    // Fix = compress AL file to <2K tokens
    const fixedDocs = docs.map(d =>
      filePaths.has(d.path) && ALWAYS_LOADED.test(d.name)
        ? { ...d, tokens: Math.min(d.tokens, 1_500), body: d.body.slice(0, 1_500) }
        : d
    );
    return computeScore(fixedDocs, blocks).score;
  }

  if (finding.group === "crossTool") {
    // Fix = consolidate to one tool, remove copies from others
    // Keep the first file, suppress the block
    const fixedBlocks = new Map(blocks);
    for (const [key, block] of fixedBlocks) {
      const blockDocs = block.docs.filter(d => filePaths.has(d.path));
      const blockTools = [...new Set(blockDocs.map(d => d.tool))];
      if (blockTools.length >= 2) {
        // Mark block as suppressed for scoring
        fixedBlocks.set(key, { ...block, suppressed: true });
      }
    }
    return computeScore(docs, fixedBlocks).score;
  }

  if (finding.group === "repeated") {
    // Fix = merge repeated copies into one (keep first, remove duplicate blocks)
    const fixedBlocks = new Map(blocks);
    for (const [key, block] of fixedBlocks) {
      const matchingDocs = block.docs.filter(d => filePaths.has(d.path));
      if (matchingDocs.length >= 2) {
        // Keep only the first doc, simulating merge
        const kept = [matchingDocs[0], ...block.docs.filter(d => !filePaths.has(d.path))];
        fixedBlocks.set(key, { ...block, docs: kept });
      }
    }
    return computeScore(docs, fixedBlocks).score;
  }

  if (finding.group === "large") {
    // Fix = split/archive to ≤20K tokens
    const fixedDocs = docs.map(d =>
      filePaths.has(d.path) ? { ...d, tokens: Math.min(d.tokens, 20_000), size: Math.min(d.size, 20_000 * 4) } : d
    );
    return computeScore(fixedDocs, blocks).score;
  }

  if (finding.group === "debris") {
    // Distinguish empty-file findings from TODO findings by subgroup
    if (finding.subgroup === "empty") {
      const fixedDocs = docs.filter(d => !filePaths.has(d.path));
      if (fixedDocs.length === 0) return 100;
      return computeScore(fixedDocs, blocks).score;
    }
    // TODO finding — clear markers
    const fixedDocs = docs.map(d =>
      filePaths.has(d.path)
        ? { ...d, body: d.body.replace(/\b(TODO|FIXME|XXX|WIP)\b/gu, "DONE") }
        : d
    );
    return computeScore(fixedDocs, blocks).score;
  }

  // stale and unknown: no score impact
  return computeScore(docs, blocks).score;
}

function normalizedDoc(doc) {
  const body = String(doc.body ?? doc.content ?? "");
  return {
    tool: doc.tool ?? doc.id ?? "project",
    path: String(doc.path ?? doc.name ?? "memory"),
    name: String(doc.name ?? path.basename(String(doc.path ?? "memory"))),
    size: Number.isFinite(doc.size) ? doc.size : Buffer.byteLength(body),
    modified: Number.isFinite(doc.modified) ? doc.modified : 0,
    body,
    tokens: estimateTokens(body),
  };
}

export function analyze(input, { os, partial, lang = "en", now = Date.now() } = {}) {
  const discovery = Array.isArray(input) ? { docs: input } : (input ?? { docs: [] });
  const docs = (discovery.docs ?? []).map(normalizedDoc);
  const text = Object.hasOwn(COPY, lang) ? COPY[lang] : COPY.en;
  const findings = [];

  const alwaysLoaded = docs.filter((doc) => ALWAYS_LOADED.test(doc.name));
  for (const doc of alwaysLoaded) {
    if (doc.tokens < 1_500) continue;
    findings.push({
      group: "alwaysLoaded",
      weight: doc.tokens > 6_000 ? 3 : 2,
      title: text.alwaysTitle(doc.name),
      measure: text.alwaysMeasure(doc.tokens),
      why: text.alwaysWhy,
      files: [doc.path],
    });
  }

  const blocks = new Map();
  for (const doc of docs) {
    const seenInDocument = new Set();
    for (const raw of doc.body.split(/\n\s*\n/gu)) {
      const normalized = normalizeBlock(raw);
      if (normalized.length < 80 || seenInDocument.has(normalized)) continue;
      seenInDocument.add(normalized);
      if (!blocks.has(normalized)) blocks.set(normalized, { sample: raw.trim(), docs: [] });
      blocks.get(normalized).docs.push(doc);
    }
  }

  for (const block of blocks.values()) {
    const tools = [...new Set(block.docs.map((doc) => doc.tool))].sort();
    if (tools.length < 2) continue;
    findings.push({
      group: "crossTool",
      weight: 3,
      title: text.crossTitle(tools),
      measure: text.crossMeasure(block.docs.length),
      why: text.crossWhy,
      files: block.docs.map((doc) => doc.path),
    });
  }

  const repeated = [];
  for (const block of blocks.values()) {
    for (const tool of new Set(block.docs.map((doc) => doc.tool))) {
      const matches = block.docs.filter((doc) => doc.tool === tool);
      if (matches.length < 2) continue;
      repeated.push({ block, tool, matches });
    }
  }
  repeated.sort((left, right) => right.matches.length - left.matches.length);
  for (const item of repeated.slice(0, 12)) {
    findings.push({
      group: "repeated",
      weight: item.matches.length >= 4 ? 3 : 2,
      title: text.repeatedTitle(item.matches.length, item.tool),
      measure: text.repeatedMeasure(item.block.sample.length),
      why: text.repeatedWhy,
      files: item.matches.map((doc) => doc.path),
    });
  }

  for (const doc of [...docs].sort((a, b) => b.size - a.size).slice(0, 3)) {
    if (doc.size < 60 * 1024) continue;
    findings.push({
      group: "large",
      weight: 1,
      title: text.largeTitle(doc.name),
      measure: text.largeMeasure(doc.size, doc.tokens),
      why: text.largeWhy,
      files: [doc.path],
    });
  }

  const empty = docs.filter((doc) => doc.body.trim().length <= 20);
  if (empty.length > 0) {
    findings.push({
      group: "debris",
      subgroup: "empty",
      weight: 1,
      title: text.emptyTitle(empty.length),
      measure: text.emptyMeasure(empty.length),
      why: text.emptyWhy,
      files: empty.map((doc) => doc.path).slice(0, 20),
    });
  }

  let todoCount = 0;
  const todoFiles = [];
  for (const doc of docs) {
    const count = (doc.body.match(/\b(TODO|FIXME|XXX|WIP)\b/gu) || []).length;
    if (count > 0) {
      todoCount += count;
      todoFiles.push(doc.path);
    }
  }
  if (todoCount >= 5) {
    findings.push({
      group: "debris",
      subgroup: "todo",
      weight: 1,
      title: text.todoTitle(todoCount),
      measure: text.todoMeasure(todoFiles.length),
      why: text.todoWhy,
      files: todoFiles.slice(0, 20),
    });
  }

  const yearAgo = now - 365 * 24 * 60 * 60 * 1_000;
  const stale = docs.filter((doc) => doc.modified > 0 && doc.modified < yearAgo);
  if (stale.length > 0) {
    findings.push({
      group: "stale",
      weight: 0,
      title: text.staleTitle(stale.length),
      measure: text.staleMeasure(stale.length),
      why: text.staleWhy,
      files: stale.map((doc) => doc.path).slice(0, 20),
    });
  }

  // ── v2 scoring ─────────────────────────────────────────────────────
  const { score, sFixed, sWaste, sHygiene } = computeScore(docs, blocks);

  // simulateFix: for each finding, compute score if that finding were resolved
  for (const finding of findings) {
    const fixedScore = simulateFix(docs, blocks, finding);
    finding.delta = Math.max(0, fixedScore - score);
    finding.severity = severityFromDelta(finding.delta);
  }

  // sort by delta descending (highest-impact first), stale always last
  findings.sort((left, right) => {
    if (left.group === "stale" && right.group !== "stale") return 1;
    if (right.group === "stale" && left.group !== "stale") return -1;
    return right.delta - left.delta;
  });

  const toolTotals = new Map();
  for (const doc of docs) {
    const totals = toolTotals.get(doc.tool) ?? { id: doc.tool, files: 0, tokens: 0 };
    totals.files += 1;
    totals.tokens += doc.tokens;
    toolTotals.set(doc.tool, totals);
  }
  const tools = [...toolTotals.values()].sort((left, right) => {
    const leftIndex = TOOL_ORDER.indexOf(left.id);
    const rightIndex = TOOL_ORDER.indexOf(right.id);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
  });
  const tokens = docs.reduce((sum, doc) => sum + doc.tokens, 0);
  const alTokens = alwaysLoaded.reduce((sum, doc) => sum + doc.tokens, 0);

  return {
    v: 2,
    os: os ?? discovery.os ?? "linux",
    tools,
    totals: { files: docs.length, tokens, alTokens },
    subscores: { fixed: sFixed, waste: sWaste, hygiene: sHygiene },
    findings,
    score,
    grade: gradeForScore(score),
    partial: Boolean(partial ?? discovery.partial),
  };
}

export const analyzeScan = analyze;
