import fs from "node:fs";
import path from "node:path";

function pendingReviews(home) {
  const file = path.join(home, "review", "queue.jsonl");
  if (!fs.existsSync(file)) return [];
  const pending = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry.status === "pending") pending.push(entry);
    } catch {
      // Ignore an incomplete trailing line.
    }
  }
  return pending;
}

function oneLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function writeReport(store, home, results) {
  void store;
  const pending = pendingReviews(home);
  const cards = pending.slice(0, 3);
  const deferred = Math.max(0, pending.length - cards.length);
  const lines = [
    `요약: 적용 ${results.applied ?? 0}건, 리뷰 대기 추가 ${results.queued ?? 0}건, 건너뜀 ${results.skipped ?? 0}건.`,
    "",
  ];

  cards.forEach((review, index) => {
    lines.push(
      `## 리뷰 카드 ${index + 1}`,
      `- pair_id: ${review.pair_id}`,
      `- 판정: ${review.verdict} (${review.confidence})`,
      `- A: ${oneLine(review.claims?.a)}`,
      `- B: ${oneLine(review.claims?.b)}`,
      `- 이유: ${oneLine(review.reason)}`,
      "",
    );
  });
  if (deferred > 0) lines.push(`이월: ${deferred}건`, "");

  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(home, "reports", `${date}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n").trimEnd()}\n`, "utf8");
  return { file, pending: pending.length, cards: cards.length, deferred };
}
