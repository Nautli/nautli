import fs from "node:fs";
import path from "node:path";
import { BRAND } from "../brand.js";
import { STATUS } from "../core/schema.js";

function scopeSlug(scope) {
  // \p{L}\p{N} 유지 필수 — ASCII만 허용하면 한글 프로젝트명이 전부 증발해
  // 13개 뷰가 views/project.md 한 파일로 충돌·유실됐다 (실사고 2026-07-17)
  return scope.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function groupBySubject(facts) {
  const groups = new Map();
  for (const fact of facts) {
    const subject = fact.subject || "기타";
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push(fact);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function renderViews(store, home) {
  const active = store.query({ status: STATUS.ACTIVE });
  const scopes = [...new Set(active.map((fact) => fact.scope))].sort();
  const files = [];

  for (const scope of scopes) {
    const facts = active.filter((fact) => fact.scope === scope);
    const lines = [
      "---",
      "generated: true",
      "---",
      `${BRAND}이 생성한 읽기전용 뷰`,
      "",
      `# ${scope}`,
      "",
    ];
    for (const [subject, grouped] of groupBySubject(facts)) {
      lines.push(`## ${subject}`);
      for (const fact of grouped) lines.push(`- ${fact.claim}`);
      lines.push("");
    }

    const file = path.join(home, "views", `${scopeSlug(scope)}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join("\n").trimEnd()}\n`, "utf8");
    files.push(file);

    // TASK-104: 생성된 읽기전용 뷰에 실제 렌더된 fact들을 전달로 로깅한다(§6 D5).
    // tool 이름은 정확히 "generated-view", 세션 미상이라 session_id는 "unknown".
    store.appendRecall({
      tool: "generated-view",
      query: "",
      scope,
      hits: facts.map((fact) => fact.id),
      source: "daemon-render",
    });
  }

  return { files };
}
