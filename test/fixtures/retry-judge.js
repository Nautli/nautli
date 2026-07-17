#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const counterFile = process.env.NAUTLI_JUDGE_RETRY_COUNTER_FILE;
if (!counterFile) throw new Error("NAUTLI_JUDGE_RETRY_COUNTER_FILE is required");

const count = fs.existsSync(counterFile)
  ? Number(fs.readFileSync(counterFile, "utf8")) + 1
  : 1;
fs.writeFileSync(counterFile, String(count), "utf8");

if (count === 1) {
  process.stderr.write("Anthropic API 529 Overloaded\n");
  process.exitCode = 1;
} else {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const input = JSON.parse(line);
    process.stdout.write(`${JSON.stringify({
      pair_id: input.pair_id,
      verdict: "related",
      confidence: 0.8,
      newer: null,
      reason: "재시도에서 정상 판정했다.",
    })}\n`);
  }
}
