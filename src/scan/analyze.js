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
    crossMeasure: (files) => `正規化した同一の段落が${files}個のファイルにあります`,
    crossWhy: "ツールごとのコピーは別々に古くなり、更新漏れが起きやすくなります。",
    repeatedTitle: (count, tool) => `同じ段落が${tool}のファイル${count}個で繰り返されています`,
    repeatedMeasure: (chars) => `原文${chars.toLocaleString("ja")}文字が繰り返されています`,
    repeatedWhy: "1つの原本を共有すれば、再読み込みコストと内容のずれを減らせます。",
    largeTitle: (name) => `${name}が通常よりかなり大きいです`,
    largeMeasure: (size, tokens) => `${formatBytes(size)} · 約${tokens.toLocaleString("ja")}トークン`,
    largeWhy: "大きな記憶ファイルは焦点を保ちにくく、再読み込みコストも高くつきます。",
    emptyTitle: (count) => `ほぼ空の記憶ファイル ${count}個`,
    emptyMeasure: (count) => `${count}個のファイルが20文字以下です`,
    emptyWhy: "空の残骸は有用な記憶を持たないまま、検索ノイズだけを増やします。",
    todoTitle: (count) => `未完了マーカーが${count}個残っています`,
    todoMeasure: (files) => `${files}個のファイルで発見`,
    todoWhy: "古いTODO、FIXME、XXX、WIPマーカーは現在の指示を曖昧にします。",
    staleTitle: (count) => `1年以上変更されていないファイル ${count}個`,
    staleMeasure: (count) => `古いファイル${count}個、スコアからは除外`,
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

export function scoreForFindings(findings) {
  const penalty = findings.reduce((sum, finding) => sum + finding.weight * 4, 0);
  return Math.max(20, 100 - Math.min(80, penalty));
}

export function estimateMonthlyUsd(alTokens) {
  return Math.round((alTokens / 1e6) * 3 * 10 * 30 * 10) / 10;
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

  const priority = { crossTool: 0, alwaysLoaded: 1, repeated: 2, large: 3, debris: 4, stale: 5 };
  findings.sort((left, right) => (
    priority[left.group] - priority[right.group] || right.weight - left.weight
  ));

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
  const score = scoreForFindings(findings);

  return {
    v: 1,
    os: os ?? discovery.os ?? "linux",
    tools,
    totals: { files: docs.length, tokens, alTokens },
    findings,
    score,
    grade: gradeForScore(score),
    estMonthlyUsd: estimateMonthlyUsd(alTokens),
    partial: Boolean(partial ?? discovery.partial),
  };
}

export const analyzeScan = analyze;
