import { spawn } from "node:child_process";

export const JUDGE_PROMPT = `너는 개인 메모리 시스템의 소화 데몬 judge다. fact 쌍마다 관계를 판정하라.

판정 기준 (오병합 비대칭 원칙: 애매하면 절대 duplicate/contradiction 주지 말고 related로):
- duplicate: 두 claim이 같은 사실. 하나로 합쳐도 정보 손실 0. 세부수치·조건이 조금이라도 다르면 duplicate 아님.
- contradiction: 동시에 참일 수 없다. 시점 차이로 한쪽이 낡은 경우 포함 (newer 필드에 최신 쪽 표기).
  단, 서로 다른 대상·조건이면 모순 아님 (예: 포트 3070=A앱, 3079=B앱은 모순 아님).
- related: 같은 주제인데 둘 다 유효 (보완 관계).
- unrelated: 유사해 보여도 실제 무관.
- confidence: 0~1. 확실할 때만 0.9+.

입력: JSONL (pair_id, claim_a(t_a), claim_b(t_b))
출력: JSONL만, 줄당 {"pair_id":"...","verdict":"duplicate|contradiction|related|unrelated","confidence":0.9,"newer":"a|b|null","reason":"한 문장"}
`;

const VERDICTS = new Set(["duplicate", "contradiction", "related", "unrelated"]);
const TIMEOUT_MS = 300_000;
const BATCH_SIZE = 20;

function pairId(pair) {
  return `${pair.a.id}:${pair.b.id}`;
}

function inputLine(pair) {
  return {
    pair_id: pairId(pair),
    claim_a: pair.a.claim,
    t_a: pair.a.t_valid,
    claim_b: pair.b.claim,
    t_b: pair.b.t_valid,
  };
}

function command(config) {
  if (Array.isArray(config?.judge_cmd) && config.judge_cmd.length > 0) {
    const [cmd, ...args] = config.judge_cmd;
    if (typeof cmd !== "string" || cmd === "" || args.some((arg) => typeof arg !== "string")) {
      throw new Error("Invalid judge_cmd");
    }
    return { cmd, args };
  }
  return {
    cmd: "claude",
    args: ["--model", "sonnet", "-p", JUDGE_PROMPT],
  };
}

function safeJudgment(pair_id, reason = "judge output missing or invalid") {
  return {
    pair_id,
    verdict: "related",
    confidence: 0,
    newer: null,
    reason,
  };
}

function validJudgment(value, expected) {
  return value
    && expected.has(value.pair_id)
    && VERDICTS.has(value.verdict)
    && typeof value.confidence === "number"
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1
    && (value.newer === "a" || value.newer === "b" || value.newer === null)
    && typeof value.reason === "string";
}

function runBatch(batch, config) {
  const invocation = command(config);
  const input = `${batch.map((pair) => JSON.stringify(inputLine(pair))).join("\n")}\n`;

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.cmd, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("Judge timed out after 300 seconds"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Judge exited with ${code ?? signal}: ${stderr.trim()}`));
        return;
      }

      const expected = new Set(batch.map(pairId));
      const parsed = new Map();
      for (const line of stdout.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const value = JSON.parse(line);
          if (validJudgment(value, expected) && !parsed.has(value.pair_id)) {
            parsed.set(value.pair_id, value);
          }
        } catch {
          // Invalid output is converted to a conservative no-op below.
        }
      }
      resolve(batch.map((pair) => parsed.get(pairId(pair)) ?? safeJudgment(pairId(pair))));
    });

    child.stdin.end(input);
  });
}

export async function judgePairs(pairs, store, config) {
  void store;
  const judgments = [];
  for (let offset = 0; offset < pairs.length; offset += BATCH_SIZE) {
    const batch = pairs.slice(offset, offset + BATCH_SIZE);
    judgments.push(...await runBatch(batch, config));
  }
  return judgments;
}
