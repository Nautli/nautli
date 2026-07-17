#!/usr/bin/env node
import readline from "node:readline";

function resolveCard(input) {
  const text = `${input.claim_a ?? ""} ${input.claim_b ?? ""} ${input.claim ?? ""}`;
  if (text.includes("낮은 확신")) {
    return {
      pair_id: input.pair_id,
      decision: input.kind === "capture" ? "discard" : "a_wins",
      evidence_summary: "관련 기록은 찾았지만 답을 확정하기에는 부족해요.",
      confidence: 0.5,
    };
  }
  if (text.includes("사람 확인")) {
    return {
      pair_id: input.pair_id,
      decision: "needs_human",
      evidence_summary: "기록만으로는 지금 원하는 방향을 확인할 수 없어요.",
      confidence: 0.92,
      crux_plain: "지금 어떤 방향을 원하는지 확인이 필요해요.",
      context_plain: "지난 작업을 정리하다가 서로 다른 방향이 발견됐어요.",
      recommend: "none",
      recommend_reason_plain: "기록만으로는 어느 쪽이 맞는지 알기 어려워요.",
    };
  }
  if (input.kind === "capture") {
    return {
      pair_id: input.pair_id,
      decision: "discard",
      evidence_summary: "다른 기억에서 계속 유지할 사실이라는 근거를 찾지 못했어요.",
      confidence: 0.91,
    };
  }
  return {
    pair_id: input.pair_id,
    decision: "a_wins",
    evidence_summary: "같은 범위의 최신 기록이 첫 번째 내용을 뒷받침해요.",
    confidence: 0.94,
  };
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.trim() === "") continue;
  process.stdout.write(`${JSON.stringify(resolveCard(JSON.parse(line)))}\n`);
}
