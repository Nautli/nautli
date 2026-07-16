#!/usr/bin/env node
import readline from "node:readline";

function triage(input) {
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
  if (`${input.claim_a ?? ""} ${input.claim_b ?? ""}`.includes("파싱 실패")) {
    process.stdout.write("not-json\n");
    continue;
  }
  process.stdout.write(`${JSON.stringify(triage(input))}\n`);
}
