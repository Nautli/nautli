import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const JUDGE_PROMPT = `[출력 규칙 최우선] 너의 응답(stdout)은 기계 파서에 그대로 들어간다. JSONL 외 어떤 텍스트(인사·설명·질문·코드펜스)도 출력하지 마라. 도구 사용·파일 읽기 금지. 입력만 보고 판정하라.

너는 개인 메모리 시스템의 소화 데몬 judge다. fact 쌍마다 관계를 판정하라.

판정 기준 (오병합 비대칭 원칙: 애매하면 절대 duplicate/contradiction 주지 말고 related로):
- duplicate: 두 claim이 같은 사실. 하나로 합쳐도 정보 손실 0. 세부수치·조건이 조금이라도 다르면 duplicate 아님.
- contradiction: 동시에 참일 수 없다. 시점 차이로 한쪽이 낡은 경우 포함 (newer 필드에 최신 쪽 표기).
  단, 서로 다른 대상·조건이면 모순 아님 (예: 포트 3070=A앱, 3079=B앱은 모순 아님).
  ⛔모순 오탐 주의 3종(PoC 실측): ①진행 누적 스냅샷("1차 8곳 발송"과 "총 26곳 발송")은 시점별 둘 다 참 = related ②규범("X 필수")과 위반 사건("X 없이 실행됨")은 모순 아님 = related ③추상 규칙("토큰만 사용")과 구체 값("색은 #FFF")처럼 층위가 다르면 모순 아님.
- related: 같은 주제인데 둘 다 유효 (보완 관계).
- unrelated: 유사해 보여도 실제 무관.
- confidence: 0~1. 확실할 때만 0.9+.

입력: JSONL (pair_id, claim_a/t_a/recorded_a, claim_b/t_b/recorded_b). t_*=사실 유효 시작일, recorded_*=기록 시각.
newer 판정: 문맥("변경되었다" 등)이 1순위, t_valid 차이가 2순위, 같으면 recorded 시각이 늦은 쪽이 newer.

출력 예시 (이 키들만, 줄당 컴팩트 JSON 1개, 여러 줄로 펼치지 말 것):
{"pair_id":"fa_x:fa_y","verdict":"contradiction","confidence":0.95,"newer":"b","reason":"포트 값이 다르고 b가 최신"}
출력: JSONL만, 줄당 {"pair_id":"...","verdict":"duplicate|contradiction|related|unrelated","confidence":0.9,"newer":"a|b|null","reason":"한 문장"}
`;

const VERDICTS = new Set(["duplicate", "contradiction", "related", "unrelated"]);
const TIMEOUT_MS = 300_000;
const BATCH_SIZE = 20;
const RAW_LOG_LIMIT = 10 * 1024 * 1024;
const ALLOWED_JUDGE_COMMANDS = new Set(["claude", "claude-patched"]);

function pairId(pair) {
  return `${pair.a.id}:${pair.b.id}`;
}

function inputLine(pair) {
  // 기록시점(t_created, 초 단위)을 함께 제공 — 같은 날짜(t_valid)의 모순도 newer 판정이 가능하게
  return {
    pair_id: pairId(pair),
    claim_a: pair.a.claim,
    t_a: pair.a.t_valid,
    recorded_a: pair.a.t_created,
    claim_b: pair.b.claim,
    t_b: pair.b.t_valid,
    recorded_b: pair.b.t_created,
  };
}

export function command(config) {
  if (Array.isArray(config?.judge_cmd) && config.judge_cmd.length > 0) {
    const [cmd, ...args] = config.judge_cmd;
    if (typeof cmd !== "string" || cmd === "" || args.some((arg) => typeof arg !== "string")) {
      throw new Error("Invalid judge_cmd");
    }
    const basename = path.basename(cmd);
    if (basename === "node") {
      if (process.env.NAUTLI_ALLOW_TEST_JUDGE !== "1") {
        throw new Error("테스트 judge는 NAUTLI_ALLOW_TEST_JUDGE=1에서만 사용할 수 있습니다.");
      }
      if (args.length !== 1 || !path.isAbsolute(args[0]) || path.extname(args[0]) !== ".js") {
        throw new Error("테스트 judge_cmd는 절대 경로의 JavaScript 파일 하나만 허용합니다.");
      }
      return { cmd, args };
    }
    if (!ALLOWED_JUDGE_COMMANDS.has(basename)) {
      throw new Error(`허용되지 않은 judge_cmd입니다: ${basename} (허용: claude, claude-patched)`);
    }
    let promptCount = 0;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "-p") {
        promptCount += 1;
        index += 1;
        // -p가 마지막 인자면 프롬프트는 코드 상수를 주입한다 (config는 바이너리·모델만 지정하는 게 정상 사용)
        if (index >= args.length) args.push(JUDGE_PROMPT);
        else if (args[index] === "") throw new Error("judge_cmd의 -p에는 프롬프트가 필요합니다.");
      } else if (arg === "--model") {
        index += 1;
        if (index >= args.length || !/^[A-Za-z0-9._-]+$/u.test(args[index])) {
          throw new Error("judge_cmd의 model 형식이 올바르지 않습니다.");
        }
      } else {
        throw new Error(`허용되지 않은 judge_cmd 인자입니다: ${arg}`);
      }
    }
    if (promptCount !== 1) {
      throw new Error("judge_cmd는 정확히 하나의 -p 프롬프트를 포함해야 합니다.");
    }
    return { cmd, args };
  }
  return {
    cmd: "claude",
    args: ["--model", "sonnet", "-p", JUDGE_PROMPT],
  };
}

function redactRawLog(text) {
  const redacted = String(text)
    .replace(/sk-[A-Za-z0-9]{8,}/gu, "[REDACTED]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/giu, "[REDACTED]")
    .replace(/Bearer\s+\S+/giu, "[REDACTED]")
    .replace(/[A-Za-z0-9+/=]{32,}/gu, "[REDACTED]");
  return redacted.split("\n").map((line) => {
    const bytes = Buffer.from(line, "utf8");
    return bytes.length <= 2048 ? line : bytes.subarray(0, 2048).toString("utf8");
  }).join("\n");
}

function appendRawLog(file, text) {
  const redacted = Buffer.from(redactRawLog(text), "utf8");
  const safeBytes = redacted.length > RAW_LOG_LIMIT
    ? redacted.subarray(redacted.length - RAW_LOG_LIMIT)
    : redacted;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = safeBytes.length;
  const currentSize = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (currentSize > 0 && currentSize + bytes > RAW_LOG_LIMIT) {
    const rolled = `${file}.1`;
    fs.rmSync(rolled, { force: true });
    fs.renameSync(file, rolled);
    fs.chmodSync(rolled, 0o600);
  }
  fs.appendFileSync(file, safeBytes, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
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

function extractJsonObjects(text) {
  // 중괄호 균형 스캔 — 한 줄 JSONL뿐 아니라 펜스·pretty-print된 JSON 오브젝트도 회수
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          objects.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // 불완전 JSON은 무시
        }
        start = -1;
      }
    }
  }
  return objects;
}

function normalizeJudgment(value) {
  // LLM 출력 관용 처리: 부가 필드 누락은 안전 기본값으로 (verdict·confidence·pair_id는 필수)
  if (!value || typeof value !== "object") return null;
  return {
    pair_id: value.pair_id,
    verdict: value.verdict,
    confidence: typeof value.confidence === "number" ? value.confidence : Number(value.confidence),
    newer: value.newer === "a" || value.newer === "b" ? value.newer : null,
    reason: typeof value.reason === "string" ? value.reason : "",
  };
}

function validJudgment(value, expected) {
  return value
    && expected.has(value.pair_id)
    && VERDICTS.has(value.verdict)
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1;
}

function runBatch(batch, config, cwd) {
  const invocation = command(config);
  const input = `${batch.map((pair) => JSON.stringify(inputLine(pair))).join("\n")}\n`;

  return new Promise((resolve, reject) => {
    // cwd = 빈 격리 디렉토리 필수 — 프로젝트 안에서 돌리면 CLI가 에이전트 모드로 리포를 탐색하며
    // 대화형 응답을 해버린다 (실측 사고: nautli 리포 cwd에서 judge가 코드 리뷰를 시작함)
    const child = spawn(invocation.cmd, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
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
        const error = new Error(`Judge exited with ${code ?? signal}`);
        error.rawStdout = stdout;
        error.rawStderr = stderr;
        reject(error);
        return;
      }

      const expected = new Set(batch.map(pairId));
      const parsed = new Map();
      for (const candidate of extractJsonObjects(stdout)) {
        const value = normalizeJudgment(candidate);
        if (validJudgment(value, expected) && !parsed.has(value.pair_id)) {
          parsed.set(value.pair_id, value);
        }
      }
      resolve({
        judgments: batch.map((pair) => parsed.get(pairId(pair)) ?? safeJudgment(pairId(pair))),
        rawStdout: stdout,
        rawStderr: stderr,
        parsedCount: parsed.size,
      });
    });

    child.stdin.end(input);
  });
}

export async function judgePairs(pairs, store, config, home) {
  void store;
  const judgments = [];
  const errors = [];
  let parsedCount = 0;
  const rawLog = home ? path.join(home, "daemon", "judge-raw.log") : null;
  // judge CLI 격리 실행장: 빈 디렉토리 (프로젝트 컨텍스트·CLAUDE.md 오염 차단)
  const sandbox = path.join(home ?? process.env.TMPDIR ?? "/tmp", "daemon", "judge-sandbox");
  fs.mkdirSync(sandbox, { recursive: true });
  for (let offset = 0; offset < pairs.length; offset += BATCH_SIZE) {
    const batch = pairs.slice(offset, offset + BATCH_SIZE);
    try {
      let result = await runBatch(batch, config, sandbox);
      if (result.parsedCount === 0 && batch.length > 0) {
        // 전량 파싱 실패 = 모델이 포맷을 무시한 회차 (비결정적) — 1회만 재시도
        if (rawLog) appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset} RETRY (0 parsed)\nstdout:\n${result.rawStdout}\nstderr:\n${result.rawStderr}\n`);
        result = await runBatch(batch, config, sandbox);
      }
      if (rawLog) appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset}\nstdout:\n${result.rawStdout}\nstderr:\n${result.rawStderr}\n`);
      parsedCount += result.parsedCount;
      if (result.parsedCount === 0 && batch.length > 0) {
        errors.push({ offset, count: batch.length, reason: "judge 응답을 해석하지 못했습니다." });
      }
      judgments.push(...result.judgments);
    } catch (error) {
      // 배치 하나의 실패(스폰 에러·타임아웃)가 밤 전체를 날리지 않게 격리 — 해당 쌍은 안전 no-op
      if (rawLog) appendRawLog(rawLog, `--- ${new Date().toISOString()} batch@${offset} FAILED: ${error.message}\nstdout:\n${error.rawStdout ?? ""}\nstderr:\n${error.rawStderr ?? ""}\n`);
      errors.push({ offset, count: batch.length, reason: error.message });
      judgments.push(...batch.map((pair) => safeJudgment(pairId(pair), `batch failed: ${error.message}`)));
    }
  }
  return { judgments, parsedCount, errors };
}
