#!/usr/bin/env node
// TASK-015 테스트용 추출 judge: 문서를 stdin으로 받아, 비어있지 않고 '#'로 시작하지 않는
// 각 줄을 원자 하나(JSONL)로 방출한다. 결정적이라 재실행 멱등성(added=0) 검증에 쓴다.
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

const scope = process.env.NAUTLI_INGEST_TEST_SCOPE || "project:ingest";
const lines = input
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

let count = 0;
for (const line of lines) {
  if (count >= 100) break;
  count += 1;
  process.stdout.write(`${JSON.stringify({
    claim: line,
    type: "semantic",
    scope,
    subject: "",
    confidence: 0.8,
  })}\n`);
}
