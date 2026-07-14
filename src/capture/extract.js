import { spawn } from "node:child_process";
import path from "node:path";
import { ERR, validScope } from "../core/schema.js";

const MAX_INPUT_BYTES = 24 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const TIMEOUT_MS = 300_000;

export const EXTRACT_PROMPT = "아래 대화 조각에서 다음 세션에도 유효한 기억을 0~5개 뽑아라. 각각 자립형 한 문장 claim, scope(project:<이름>|person|procedure), confidence(0~1). JSON 배열만 출력.";

function failed(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = ERR.E_EXTRACT_FAILED;
  return error;
}

function cappedInput(value) {
  const input = Buffer.from(value, "utf8");
  if (input.length <= MAX_INPUT_BYTES) {
    return { text: value, truncated: false };
  }

  let start = input.length - MAX_INPUT_BYTES;
  while (start < input.length && (input[start] & 0xc0) === 0x80) start += 1;
  return { text: input.subarray(start).toString("utf8"), truncated: true };
}

function invocation(config) {
  const configured = config?.judge_cmd;
  if (configured !== undefined && configured !== null && !Array.isArray(configured)) {
    throw failed("Invalid judge_cmd");
  }
  const argv = configured?.length > 0
    ? [...configured]
    : ["claude", "--model", "sonnet", "-p", EXTRACT_PROMPT];
  if (argv.some((part) => typeof part !== "string") || argv[0] === "") {
    throw failed("Invalid judge_cmd");
  }

  const [cmd, ...args] = argv;
  if (["claude", "claude-patched"].includes(path.basename(cmd))) {
    const promptIndex = args.indexOf("-p");
    if (promptIndex < 0) args.push("-p", EXTRACT_PROMPT);
    else if (promptIndex === args.length - 1) args.push(EXTRACT_PROMPT);
    else args[promptIndex + 1] = EXTRACT_PROMPT;
  }
  return { cmd, args };
}

function stripFence(stdout) {
  const trimmed = stdout.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseCandidates(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stripFence(stdout));
  } catch (cause) {
    throw failed("Extractor output is not valid JSON", cause);
  }
  if (!Array.isArray(parsed) || parsed.length > 5) {
    throw failed("Extractor output must be an array with at most five candidates");
  }

  return parsed.map((candidate) => {
    const confidence = typeof candidate?.confidence === "number"
      ? candidate.confidence
      : Number(candidate?.confidence);
    if (!candidate
      || typeof candidate.claim !== "string"
      || candidate.claim.trim() === ""
      || candidate.claim.length > 280
      || !validScope(candidate.scope)
      || !Number.isFinite(confidence)
      || confidence < 0
      || confidence > 1) {
      throw failed("Extractor returned an invalid candidate");
    }
    return {
      claim: candidate.claim.trim(),
      scope: candidate.scope,
      confidence,
    };
  });
}

export async function extractCandidates(deltaText, config = {}) {
  if (typeof deltaText !== "string") throw failed("deltaText must be a string");
  const input = cappedInput(deltaText);
  const command = invocation(config);

  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(command.cmd, command.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    let stderr = "";
    let settled = false;
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(failed("Extractor timed out")));
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(failed("Extractor output is too large")));
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (cause) => finish(() => reject(failed("Extractor could not start", cause))));
    child.on("close", (code, signal) => finish(() => {
      if (code !== 0) {
        reject(failed(`Extractor exited with ${code ?? signal}: ${stderr.trim()}`));
      } else {
        resolve(output);
      }
    }));
    child.stdin.end(input.text);
  });

  return {
    candidates: parseCandidates(stdout),
    truncated: input.truncated,
  };
}
