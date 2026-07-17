import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyCaptureCard } from "../core/review.js";
import { withReviewLock } from "../core/review-lock.js";
import { appendRawLog, buildCommand, extractJsonObjects } from "./judge.js";

export const TRIAGE_PROMPT = `[출력 규칙 최우선] 너의 응답(stdout)은 기계 파서에 그대로 들어간다. JSONL 외 어떤 텍스트(인사·설명·질문·코드펜스)도 출력하지 마라. 도구 사용·파일 읽기 금지. 입력만 보고 판정하라.

너는 개인 메모리 시스템의 리뷰 카드 트리아지다. 사람 큐로 가려는 카드마다 최종 route를 판정하라.

라우팅 기준:
- human = 사람만 답할 수 있는 것(개인 선호·의도·사업 결정·사람에 관한 사실)이면서 동시에 유저에게 중요한 것. 이 두 조건을 모두 확실히 만족할 때만.
- 주제가 아니라 질문 자체를 보라: 주제가 사업·프로젝트라도 verdict가 duplicate이고 두 claim이 같은 사실의 표현 차이일 뿐이라 합쳐도 잃는 게 없으면 machine이다. human은 답을 고르는 데 사람의 선호·의도·기억이 필요할 때만이다(예: 서로 다른 두 결정 중 무엇이 지금 유효한지는 기록만으로 알 수 없을 때).
- machine = 두 claim이 코드·빌드·배포·인프라·설정·CLI 절차 같은 기술 기록이고 정답을 레포·로그·레지스트리·시스템 확인으로 알 수 있는 것.
- auto = 고객사·발굴 대상·외부 업체 같은 운영 데이터라 유저가 답할 이유가 없는 것.
- 애매하면 human이 아니라 machine으로 보내라. 사람 큐는 확실한 것만 받는다(잘못 걸러진 카드는 삭제되지 않고 보류로 리포트에 남아 되돌릴 수 있다).
- crux_plain: 비개발자가 읽는 쉬운말 한 문장. 전문용어(launchd·plist·리포지토리·StandardOut 등) 금지, 줄표(—) 금지, 호칭(사장님·고객님 등) 금지. 예: "컴퓨터가 켜질 때 자동으로 실행되는 설정에 관한 기술 메모 두 개가 같은 내용으로 보여요."

입력: JSONL (pair_id, verdict, crux, reason, claim_a, claim_b, scope).

출력: JSONL만, 줄당 컴팩트 JSON 1개, 여러 줄로 펼치지 말 것.
{"pair_id":"...","route":"human|machine|auto","why":"한 문장","crux_plain":"route=human일 때만"}
`;

export const CAPTURE_TRIAGE_PROMPT = `[출력 규칙 최우선] 너의 응답(stdout)은 기계 파서에 그대로 들어간다. JSONL 외 어떤 텍스트(인사·설명·질문·코드펜스)도 출력하지 마라. 도구 사용·파일 읽기 금지. 입력만 보고 판정하라.

너는 개인 메모리 시스템의 자동 캡처 리뷰 카드 트리아지다. 대화 세션에서 발견되어 사람 큐로 가려는 카드마다 최종 route를 판정하라.

라우팅 기준:
- remember = 코드·빌드·배포·인프라·설정·프로젝트 상태 같은 기술·프로젝트·시스템 기록이고, 입력 claim이 세션에서 실제로 확정된 사실이다. 사람에게 묻지 않고 AI가 대신 저장한다.
- human = 사람의 선호·의도·사업 결정처럼 사람만 답할 수 있으면서 동시에 유저에게 중요한 것이다. 이 두 조건을 모두 확실히 만족할 때만 사용한다.
- hold = 애매하거나 일회성이거나 잡음인 내용이다. 세션에서 실제 확정된 사실인지 불분명하거나 remember와 human 중 하나로 확실히 고를 수 없으면 hold다. 카드는 삭제되지 않고 큐와 리포트 기록에 남는다.
- 기술 용어가 있다는 이유만으로 remember하지 마라. 실제 확정된 기술·프로젝트·시스템 사실이어야 한다.
- crux_plain: route=human일 때 필수다. 비개발자가 읽는 쉬운말 한 문장으로 쓰고, 전문용어와 줄표와 호칭을 쓰지 마라.
- context_plain: route=human일 때 필수다. 언제 나온 말인지 날짜를 자연어로 쓰고, 어떤 작업을 하던 중 나온 내용인지 쉬운말 한 문장으로 설명하라. claim에서 맥락을 유추하고 project 경로는 마지막 폴더 이름 정도만 참고하라. 전문용어와 줄표와 호칭을 쓰지 마라.
- recommend: route=human일 때 필수다. 기억할 가치가 있으면 remember, 버려도 되면 dismissed, AI도 판단을 유보하면 none으로 출력하라.
- recommend_reason_plain: route=human일 때 필수다. 왜 그렇게 추천하는지 쉬운말 한 문장으로 설명하고, 전문용어와 줄표와 호칭을 쓰지 마라.

입력: JSONL (pair_id, claim, scope, project, at, confidence).

출력: JSONL만, 줄당 컴팩트 JSON 1개, 여러 줄로 펼치지 말 것.
{"pair_id":"...","route":"remember|human|hold","why":"한 문장","crux_plain":"route=human일 때 필수","context_plain":"route=human일 때 필수","recommend":"remember|dismissed|none","recommend_reason_plain":"route=human일 때 필수"}
`;

const ROUTES = new Set(["human", "machine", "auto"]);
const CAPTURE_ROUTES = new Set(["remember", "human", "hold"]);
const CAPTURE_RECOMMENDATIONS = new Set(["remember", "dismissed", "none"]);
const TIMEOUT_MS = 300_000;
const BATCH_SIZE = 20;

export function command(config) {
  return buildCommand(config, "triage_cmd", TRIAGE_PROMPT);
}

function runBatch(
  batch,
  invocation,
  cwd,
  routes,
  { requireHumanCrux = false, captureHumanDetails = false } = {},
) {
  const input = `${batch.map((card) => JSON.stringify(card)).join("\n")}\n`;

  return new Promise((resolve, reject) => {
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
        reject(new Error("Triage timed out after 300 seconds"));
        return;
      }
      if (code !== 0) {
        const error = new Error(`Triage exited with ${code ?? signal}`);
        error.rawStdout = stdout;
        error.rawStderr = stderr;
        reject(error);
        return;
      }

      const expected = new Set(batch.map((card) => card.pair_id));
      const parsed = new Map();
      for (const value of extractJsonObjects(stdout)) {
        if (!value || typeof value !== "object"
          || !expected.has(value.pair_id)
          || !routes.has(value.route)
          || (requireHumanCrux
            && value.route === "human"
            && (typeof value.crux_plain !== "string"
              || value.crux_plain.trim() === ""
              || /[—–]/u.test(value.crux_plain)))
          || parsed.has(value.pair_id)) continue;
        const validPlain = (field) => typeof field === "string"
          && field.trim() !== ""
          && !/[—–]/u.test(field);
        parsed.set(value.pair_id, {
          route: value.route,
          why: typeof value.why === "string" ? value.why : "",
          ...(typeof value.crux_plain === "string" ? { crux_plain: value.crux_plain } : {}),
          ...(captureHumanDetails && value.route === "human"
            ? {
              ...(validPlain(value.context_plain)
                ? { context_plain: value.context_plain }
                : {}),
              recommend: CAPTURE_RECOMMENDATIONS.has(value.recommend)
                ? value.recommend
                : "none",
              ...(validPlain(value.recommend_reason_plain)
                ? { recommend_reason_plain: value.recommend_reason_plain }
                : {}),
            }
            : {}),
        });
      }
      resolve({ parsed, parsedCount: parsed.size, rawStdout: stdout, rawStderr: stderr });
    });

    child.stdin.end(input);
  });
}

export async function triageCards(cards, config, home) {
  // 잘못된 명령은 호출 즉시 드러내고, 실행 중 개별 배치 실패만 fail-open으로 격리한다.
  const invocation = command(config);
  return triageBatches(cards, invocation, home, ROUTES, "pair");
}

async function triageBatches(
  cards,
  invocation,
  home,
  routes,
  label,
  options = {},
) {
  const results = new Map();
  const rawLog = path.join(home, "daemon", "triage-raw.log");
  const sandbox = path.join(home, "daemon", "triage-sandbox");
  fs.mkdirSync(sandbox, { recursive: true });

  for (let offset = 0; offset < cards.length; offset += BATCH_SIZE) {
    const batch = cards.slice(offset, offset + BATCH_SIZE);
    try {
      let result = await runBatch(batch, invocation, sandbox, routes, options);
      if (result.parsedCount === 0 && batch.length > 0) {
        appendRawLog(rawLog, `--- ${new Date().toISOString()} ${label} batch@${offset} RETRY (0 parsed)\nstdout:\n${result.rawStdout}\nstderr:\n${result.rawStderr}\n`);
        result = await runBatch(batch, invocation, sandbox, routes, options);
      }
      appendRawLog(rawLog, `--- ${new Date().toISOString()} ${label} batch@${offset}\nstdout:\n${result.rawStdout}\nstderr:\n${result.rawStderr}\n`);
      for (const [pairId, triage] of result.parsed) results.set(pairId, triage);
    } catch (error) {
      appendRawLog(rawLog, `--- ${new Date().toISOString()} ${label} batch@${offset} FAILED: ${error.message}\nstdout:\n${error.rawStdout ?? ""}\nstderr:\n${error.rawStderr ?? ""}\n`);
      // fail-open: 이 배치의 카드는 Map에 넣지 않아 기존 사람 큐 동작을 유지한다.
    }
  }
  return results;
}

export async function triageCaptureCards(cards, config, home) {
  const invocation = buildCommand(config, "triage_cmd", CAPTURE_TRIAGE_PROMPT);
  const inputCards = cards.map((card) => ({
    pair_id: card.pair_id,
    claim: card.claim,
    scope: card.scope,
    project: card.project,
    at: card.at,
    confidence: card.confidence,
  }));
  return triageBatches(inputCards, invocation, home, CAPTURE_ROUTES, "capture", {
    requireHumanCrux: true,
    captureHumanDetails: true,
  });
}

function queueFile(home) {
  return path.join(home, "review", "queue.jsonl");
}

function readQueue(home) {
  const file = queueFile(home);
  if (!fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    entries.push(JSON.parse(line));
  }
  return entries;
}

function writeQueue(home, entries) {
  const file = queueFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const data = entries.length === 0 ? "" : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function cardFromQueueEntry(entry, store) {
  const ids = typeof entry.pair_id === "string" ? entry.pair_id.split(":") : [];
  const a = ids.length === 2 ? store.getFact(ids[0]) : null;
  const b = ids.length === 2 ? store.getFact(ids[1]) : null;
  return {
    pair_id: entry.pair_id,
    verdict: entry.verdict,
    crux: entry.crux,
    reason: entry.reason,
    claim_a: a?.claim ?? entry.claims?.a,
    claim_b: b?.claim ?? entry.claims?.b,
    scope: a?.scope ?? b?.scope ?? entry.scope,
  };
}

function hasHumanTriage(entry) {
  return typeof entry.crux_plain === "string" && entry.crux_plain.trim() !== "";
}

function enrichHumanEntry(entry, result, fields) {
  if (result?.route !== "human") return entry;
  const enrichment = {};
  for (const field of fields) {
    if (Object.hasOwn(result, field)) enrichment[field] = result[field];
  }
  return Object.keys(enrichment).length > 0 ? { ...entry, ...enrichment } : entry;
}

export async function triagePendingQueue(store, home, config) {
  const pending = withReviewLock(home, () => readQueue(home)
    .filter((entry) => entry.status === "pending"));
  const pairPending = pending.filter((entry) => entry.type !== "capture");
  const capturePending = pending.filter((entry) => entry.type === "capture");
  const triaged = pairPending.length > 0
    ? await triageCards(
      pairPending.map((entry) => cardFromQueueEntry(entry, store)),
      config,
      home,
    )
    : new Map();
  const captureTriaged = capturePending.length > 0
    ? await triageCaptureCards(capturePending, config, home)
    : new Map();
  let captureRemembered = 0;
  for (const entry of capturePending) {
    // 한번 사람 확인 대상으로 판정된 카드는 재트리아지가 자동 저장할 수 없다.
    if (hasHumanTriage(entry)) continue;
    if (captureTriaged.get(entry.pair_id)?.route !== "remember") continue;
    try {
      const applied = applyCaptureCard(
        store,
        home,
        entry.pair_id,
        "remember",
        config,
        { actor: "triage" },
      );
      if (applied.ok) captureRemembered += 1;
    } catch {
      // fail-open: 저장에 실패한 캡처 카드는 pending 상태로 남겨 사람이 확인할 수 있게 한다.
    }
  }

  let pairRouted = 0;
  let captureHeld = 0;
  const routedAt = new Date().toISOString();

  withReviewLock(home, () => {
    const queue = readQueue(home);
    let changed = false;
    const updated = queue.map((entry) => {
      if (entry.status !== "pending") return entry;
      if (entry.type === "capture") {
        const result = captureTriaged.get(entry.pair_id);
        if (hasHumanTriage(entry)) {
          const enriched = enrichHumanEntry(entry, result, [
            "crux_plain",
            "context_plain",
            "recommend",
            "recommend_reason_plain",
          ]);
          if (enriched !== entry) changed = true;
          return enriched;
        }
        if (result?.route === "hold") {
          captureHeld += 1;
          changed = true;
          return {
            ...entry,
            status: "routed",
            route: "hold",
            routed_at: routedAt,
            handled_at: routedAt,
            answered_by: "triage",
          };
        }
        if (result?.route === "human") {
          const enriched = enrichHumanEntry(entry, result, [
            "crux_plain",
            "context_plain",
            "recommend",
            "recommend_reason_plain",
          ]);
          if (enriched !== entry) changed = true;
          return enriched;
        }
        return entry;
      }
      const result = triaged.get(entry.pair_id);
      if (hasHumanTriage(entry)) {
        const enriched = enrichHumanEntry(entry, result, ["crux_plain"]);
        if (enriched !== entry) changed = true;
        return enriched;
      }
      if (result?.route === "machine" || result?.route === "auto") {
        pairRouted += 1;
        changed = true;
        return {
          ...entry,
          status: "routed",
          route: result.route,
          routed_at: routedAt,
          handled_at: routedAt,
          answered_by: "triage",
        };
      }
      if (result?.route === "human") {
        const enriched = enrichHumanEntry(entry, result, ["crux_plain"]);
        if (enriched !== entry) changed = true;
        return enriched;
      }
      return entry;
    });
    if (changed) writeQueue(home, updated);
  });

  const routed = pairRouted + captureRemembered + captureHeld;
  return {
    checked: pending.length,
    routed,
    kept: pending.length - routed,
    capture_remembered: captureRemembered,
    capture_held: captureHeld,
  };
}
