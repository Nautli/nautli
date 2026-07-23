// TASK-015: ingest v0 — 로컬 문서(.md/.txt)를 원자 fact로 분해해 remember 게이트로 적재한다.
// 규칙: ①URL/PDF는 명시적 거부 ②추출 judge는 최대 100개 원자 ③모든 원자는 기존 remember 게이트를
// 통과(직접 store 쓰기 금지, dedup/검증 재사용) ④새 fact는 기존 active fact와 1회 pair/judge하고
// related 판정은 기존 store.upsertEdge(TASK-013)로만 엣지를 남긴다.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { remember } from "./gate.js";
import { ERR, STATUS } from "./schema.js";
import { buildCommand, extractJsonObjects, judgePairs } from "../daemon/judge.js";

const MAX_ATOMS = 100;
const ATOM_TYPES = new Set(["episodic", "semantic", "procedural"]);
const EXTRACT_TIMEOUT_MS = 300_000;
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

export const INGEST_PROMPT = `[출력 규칙 최우선] 너의 응답(stdout)은 기계 파서에 그대로 들어간다. JSONL 외 어떤 텍스트(인사·설명·질문·코드펜스)도 출력하지 마라. 도구 사용·파일 읽기 금지. 입력 문서만 보고 분해하라.

너는 개인 메모리 시스템의 ingest judge다. 입력으로 받은 문서를 앞으로 다시 쓰일 만한 "원자 사실"들로 분해하라.
- 원자 사실 = 독립적으로 참인 한 문장. 목록·복합문은 쪼개라.
- 잡담·추측·일회성 정보·미검증 내용·작업 중간과정은 버려라.
- 최대 100개. 정말 저장 가치가 있는 것만.

각 원자를 줄당 컴팩트 JSON 1개로 출력하라(이 키들만):
{"claim":"한 문장 사실","type":"episodic|semantic|procedural","scope":"person|procedure|project:<이름>","subject":"주제(선택)","confidence":0.0}
- claim: 280자 이내 한 문장.
- type: 사건=episodic, 일반지식·선호=semantic, 절차·워크플로=procedural.
- scope: 개인 선호·정보=person, 여러 프로젝트 공통 절차=procedure, 특정 프로젝트=project:<이름>.
- confidence: 0~1. 확실할 때만 0.9+.
출력: JSONL만.
`;

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// TASK-015: v0 입력 검증 — 로컬 .md/.txt만. URL/PDF/기타 확장자는 명시적 거부.
export function validateIngestPath(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw codedError(ERR.E_INVALID_INPUT, "ingest requires a file path");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(filePath)) {
    throw codedError(ERR.E_INGEST_UNSUPPORTED, "URL ingest is not supported in v0 (local .md/.txt only)");
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    throw codedError(ERR.E_INGEST_UNSUPPORTED, "PDF ingest is not supported in v0 (local .md/.txt only)");
  }
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw codedError(ERR.E_INGEST_UNSUPPORTED, `unsupported file type '${ext || "(none)"}' — v0 supports .md/.txt only`);
  }
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw codedError(ERR.E_NOT_FOUND, `file not found: ${resolved}`);
  return resolved;
}

function normalizeAtom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const claim = typeof raw.claim === "string" ? raw.claim.trim() : "";
  if (claim === "") return null;
  const atom = { claim };
  if (ATOM_TYPES.has(raw.type)) atom.type = raw.type;
  if (typeof raw.scope === "string" && raw.scope.trim() !== "") atom.scope = raw.scope.trim();
  if (typeof raw.subject === "string") atom.subject = raw.subject;
  const confidence = Number(raw.confidence);
  if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) atom.confidence = confidence;
  return atom;
}

// TASK-015: 추출 judge를 데몬과 동일한 headless CLI 기법으로 실행한다(문서는 stdin, 원자는 stdout JSONL).
function runExtract(text, config, home) {
  const invocation = buildCommand(config, "ingest_cmd", INGEST_PROMPT);
  const sandbox = path.join(home ?? process.env.TMPDIR ?? "/tmp", "daemon", "ingest-sandbox");
  fs.mkdirSync(sandbox, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.cmd, invocation.args, { stdio: ["pipe", "pipe", "pipe"], cwd: sandbox });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, EXTRACT_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("ingest extraction timed out"));
        return;
      }
      if (code !== 0) {
        const error = new Error(`ingest extraction exited with ${code ?? signal}`);
        error.code = ERR.E_EXTRACT_FAILED;
        error.rawStderr = stderr;
        reject(error);
        return;
      }
      resolve(extractJsonObjects(stdout));
    });
    child.stdin.end(text);
  });
}

// TASK-015: 새 fact들을 기존 active fact와만 짝지어 후보 쌍을 만든다(new × existing, 같은 scope).
function discoverPairs(store, newFactIds, existingActiveIds) {
  const found = new Map();
  for (const id of newFactIds) {
    const fact = store.getFact(id);
    if (!fact) continue;
    for (const match of store.searchFts(fact.claim, { scope: fact.scope, limit: 6 })) {
      if (match.id === id || !existingActiveIds.has(match.id)) continue;
      const candidate = store.getFact(match.id);
      if (!candidate || candidate.scope !== fact.scope) continue;
      const [a, b] = fact.id < candidate.id ? [fact, candidate] : [candidate, fact];
      const pairKey = `${a.id}:${b.id}`;
      if (!found.has(pairKey)) found.set(pairKey, { a, b });
    }
  }
  return [...found.values()];
}

/**
 * TASK-015: 문서 하나를 원자 fact로 분해해 적재한다.
 * @param options.extract 테스트용 주입 추출기(hermetic). 기본은 headless CLI.
 * @returns { source, extracted, added, duplicates, rejected, judged }
 */
export async function ingest(store, filePath, config = {}, options = {}) {
  const resolved = validateIngestPath(filePath);
  const realpath = fs.realpathSync(resolved);
  const text = fs.readFileSync(realpath, "utf8");

  const extractor = options.extract ?? runExtract;
  const rawAtoms = await extractor(text, config, store.home);
  const atoms = (Array.isArray(rawAtoms) ? rawAtoms : [])
    .map(normalizeAtom)
    .filter((atom) => atom !== null)
    .slice(0, MAX_ATOMS);

  // 새 fact를 기존 active fact와만 짝지으려고 적재 전 스냅샷을 잡는다.
  const existingActiveIds = new Set(store.query({ status: STATUS.ACTIVE }).map((fact) => fact.id));

  let added = 0;
  let duplicates = 0;
  let rejected = 0;
  const newFactIds = [];
  for (const atom of atoms) {
    const result = remember(store, {
      claim: atom.claim,
      type: atom.type,
      scope: atom.scope,
      subject: atom.subject,
      confidence: atom.confidence,
      source: "ingest",
      provenance: { path: realpath },
    }, config);
    if (result.status === "added") {
      added += 1;
      newFactIds.push(result.id);
    } else if (result.status === "duplicate") {
      duplicates += 1;
    } else {
      rejected += 1;
    }
  }

  // TASK-015: 새 fact ↔ 기존 active fact 1회 pair/judge. related만 upsertEdge(TASK-013)로 엣지.
  let judged = 0;
  if (newFactIds.length > 0) {
    const pairs = discoverPairs(store, newFactIds, existingActiveIds);
    if (pairs.length > 0) {
      const judgeResult = await judgePairs(pairs, store, config, store.home);
      judged = pairs.length;
      for (const judgment of judgeResult.judgments) {
        if (judgment?.verdict !== "related") continue;
        const ids = String(judgment.pair_id).split(":");
        if (ids.length !== 2) continue;
        const confidence = Number(judgment.confidence);
        store.upsertEdge({
          a_id: ids[0],
          b_id: ids[1],
          kind: "related",
          confidence: Number.isFinite(confidence) && confidence > 0 ? confidence : 0.5,
          source: "ingest",
        });
      }
    }
  }

  return { source: realpath, extracted: atoms.length, added, duplicates, rejected, judged };
}
