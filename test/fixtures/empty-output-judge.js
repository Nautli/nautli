#!/usr/bin/env node
// exit 0이지만 JSONL을 출력하지 않음 — parsedCount=0 경로 테스트용
process.stderr.write("model refused to produce JSONL\n");
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write("I cannot help with that request.\n");
});
