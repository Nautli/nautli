#!/usr/bin/env node
import readline from "node:readline";

function triage(input) {
  if (typeof input.claim === "string") {
    if (input.claim.includes("기술 기록")) {
      return {
        pair_id: input.pair_id,
        route: "remember",
        why: "세션에서 확정된 프로젝트 기술 기록이다.",
      };
    }
    if (input.claim.includes("일회성")) {
      return {
        pair_id: input.pair_id,
        route: "hold",
        why: "계속 기억할 사실인지 불분명한 일회성 내용이다.",
      };
    }
    return {
      pair_id: input.pair_id,
      route: "human",
      why: "중요한 사람의 결정이라 직접 확인해야 한다.",
      crux_plain: "앞으로 이 결정을 계속 따를지 확인이 필요해요.",
    };
  }
  const claims = `${input.claim_a ?? ""} ${input.claim_b ?? ""}`;
  if (claims.includes("운영 데이터")) {
    return {
      pair_id: input.pair_id,
      route: "auto",
      why: "유저가 직접 판단할 필요가 없는 운영 데이터다.",
    };
  }
  if (claims.includes("기술 기록")) {
    return {
      pair_id: input.pair_id,
      route: "machine",
      why: "시스템 기록으로 확인할 수 있는 기술 내용이다.",
    };
  }
  return {
    pair_id: input.pair_id,
    route: "human",
    why: "유저의 중요한 개인 선호라 사람만 답할 수 있다.",
    crux_plain: "앞으로 어떤 방식을 더 중요하게 생각하는지 확인이 필요해요.",
  };
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.trim() === "") continue;
  const input = JSON.parse(line);
  if (`${input.claim ?? ""} ${input.claim_a ?? ""} ${input.claim_b ?? ""}`
    .includes("파싱 실패")) {
    process.stdout.write("not-json\n");
    continue;
  }
  process.stdout.write(`${JSON.stringify(triage(input))}\n`);
}
