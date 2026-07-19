#!/usr/bin/env node
import readline from "node:readline";

function decide(input) {
  // 증거에 "corroborate" 키워드가 있으면 corroborate
  const evidenceText = (input.evidence || []).map((e) => e.claim).join(" ");
  if (evidenceText.includes("확인") || evidenceText.includes("corroborate")) {
    return {
      undo_id: input.undo_id,
      decision: "corroborate",
      evidence_summary: "새 기억이 원래 판정을 지지한다.",
      confidence: 0.9,
    };
  }
  if (evidenceText.includes("반박") || evidenceText.includes("contradict")) {
    return {
      undo_id: input.undo_id,
      decision: "contradict",
      evidence_summary: "새 기억이 원래 판정을 반박한다.",
      confidence: 0.9,
    };
  }
  return {
    undo_id: input.undo_id,
    decision: "no_signal",
    evidence_summary: "관련 증거가 부족하다.",
    confidence: 0.5,
  };
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.trim() === "") continue;
  const input = JSON.parse(line);
  process.stdout.write(`${JSON.stringify(decide(input))}\n`);
}
