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
  const pending = pendingReviews(home).filter((review) => review.type !== "capture");
  const cards = pending.slice(0, 3);
  const deferred = Math.max(0, pending.length - cards.length);
  const machineOracle = results.machine_oracle ?? 0;
  const triageRouted = results.triage_routed ?? 0;
  const captureRemembered = results.capture_remembered ?? 0;
  const captureHeld = results.capture_held ?? 0;
  const summaryParts = [
    `적용 ${results.applied ?? 0}건`,
    `리뷰 대기 추가 ${results.queued ?? 0}건`,
    `건너뜀 ${results.skipped ?? 0}건`,
  ];
  if (machineOracle > 0) summaryParts.push(`기술 기록 보류 ${machineOracle}건`);
  if (triageRouted > 0) summaryParts.push(`AI가 대신 맡음 ${triageRouted}건`);
  if (captureRemembered > 0) summaryParts.push(`AI가 대신 기억함 ${captureRemembered}건`);
  if (captureHeld > 0) summaryParts.push(`보류 ${captureHeld}건`);
  const summary = `요약: ${summaryParts.join(", ")}.`;
  const lines = [summary];
  const failedPairs = results.failed_pairs ?? 0;
  if (failedPairs > 0) {
    lines.push(`(판정 ${failedPairs}쌍은 일시 오류로 건너뜀: 다음 소화 때 다시 시도해요)`);
  }
  if (machineOracle > 0) {
    lines.push("(기술 기록 보류: 정답이 레포나 로그에 있는 갈림이라 사람에게 묻지 않았어요)");
  }
  if (triageRouted > 0) {
    lines.push("(AI가 대신 맡음: 사람이 답할 필요 없는 질문이라 보류해 뒀어요)");
  }
  if (captureHeld > 0) {
    lines.push("(보류: 확정하기 어려운 자동 발견은 지우지 않고 기록에 남겼어요)");
  }
  lines.push("");

  cards.forEach((review, index) => {
    const duplicate = review.verdict === "duplicate";
    const headline = oneLine(review.crux_plain) || oneLine(review.crux) || (duplicate
      ? "이 두 기억이 같은 내용 같아요."
      : "두 기억이 동시에 맞기 어려워 보여요.");
    const question = duplicate
      ? "하나로 합칠까요? (O / X / 모름)"
      : "지금은 어느 쪽이 맞나요? (A / B / 둘 다 / 모름)";
    const recommendation = review.newer === "a" || review.newer === "b"
      ? `데몬 추천: ${review.newer.toUpperCase()}가 최신으로 보여요 (확신 ${Math.round(Number(review.confidence) * 100)}%)`
      : null;
    const reason = oneLine(review.reason);
    lines.push(
      `## 리뷰 카드 ${index + 1}`,
      `**${headline}**`,
      `질문: ${question}`,
    );
    if (recommendation) lines.push(recommendation);
    lines.push(
      "응답은 대시보드에서: npx nautli dashboard",
      "",
      "참고(원문)",
      `- A: ${oneLine(review.claims?.a)}`,
      `- B: ${oneLine(review.claims?.b)}`,
      `- 판정: ${review.verdict} ${review.confidence} · pair: ${review.pair_id}${reason ? ` · 이유: ${reason}` : ""}`,
      "",
    );
  });
  if (deferred > 0) lines.push(`이월: ${deferred}건`, "");

  // 로컬 날짜 필수 — UTC면 KST 새벽 실행(04:14)이 전날 리포트를 덮어쓴다 (실사고 2026-07-17)
  const date = new Date().toLocaleDateString("sv-SE");
  const file = path.join(home, "reports", `${date}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n").trimEnd()}\n`, "utf8");
  return { file, pending: pending.length, cards: cards.length, deferred };
}
