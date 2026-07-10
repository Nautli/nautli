import fs from "node:fs";
import path from "node:path";
import { BRAND } from "../brand.js";
import { STATUS } from "../core/schema.js";

function scopeSlug(scope) {
  return scope.replace(/[^a-z0-9-]+/gu, "-").replace(/^-|-$/gu, "");
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
  }

  return { files };
}
