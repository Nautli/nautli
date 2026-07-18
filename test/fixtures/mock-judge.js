#!/usr/bin/env node
import readline from "node:readline";

function newer(input) {
  if (input.t_a < input.t_b) return "b";
  if (input.t_b < input.t_a) return "a";
  return null;
}

function judgment(input) {
  const claims = `${input.claim_a} ${input.claim_b}`;
  if ((String(input.claim_a).includes("포트") || String(input.claim_a).includes("port")) && (String(input.claim_b).includes("포트") || String(input.claim_b).includes("port"))) {
    return {
      pair_id: input.pair_id,
      verdict: "contradiction",
      confidence: 0.95,
      newer: newer(input),
      reason: "같은 포트 설정의 값이 다르다.",
    };
  }
  if (claims.includes("고신뢰중복")) {
    return {
      pair_id: input.pair_id,
      verdict: "duplicate",
      confidence: 0.95,
      newer: newer(input),
      reason: "정보 손실 없이 하나로 합칠 수 있다.",
    };
  }
  if (claims.includes("검토중복") || claims.includes("review-duplicate")) {
    return {
      pair_id: input.pair_id,
      verdict: "duplicate",
      confidence: 0.7,
      newer: newer(input),
      reason: "중복으로 보이지만 사람의 검토가 필요하다.",
    };
  }
  if (claims.includes("무관판정")) {
    return {
      pair_id: input.pair_id,
      verdict: "unrelated",
      confidence: 0.99,
      newer: null,
      reason: "표면 단어만 비슷하고 서로 무관하다.",
    };
  }
  return {
    pair_id: input.pair_id,
    verdict: "related",
    confidence: 0.5,
    newer: null,
    reason: "같은 주제일 수 있으나 병합 근거가 부족하다.",
  };
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.trim() === "") continue;
  const input = JSON.parse(line);
  process.stdout.write(`${JSON.stringify(judgment(input))}\n`);
}
