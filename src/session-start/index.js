import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STATUS } from "../core/schema.js";
import { Store } from "../core/store.js";
import { computeFreshness } from "../core/validity.js";

const TOKEN_BUDGET = 300;
const CHARS_PER_TOKEN = 3;
const MAX_CHARS = TOKEN_BUDGET * CHARS_PER_TOKEN;

const DAEMON_CWD_PATTERNS = [
  /\/\.nautli\b/,
  /\/daemon\b/,
];

const SUBAGENT_SESSION_PATTERNS = [
  /^subagent-/i,
  /^agent-/i,
  /^test-/i,
  /^ci-/i,
];

export function isExcludedSession(sessionId, cwd) {
  if (!sessionId || typeof sessionId !== "string") return true;
  if (SUBAGENT_SESSION_PATTERNS.some((pattern) => pattern.test(sessionId))) return true;
  if (typeof cwd === "string" && DAEMON_CWD_PATTERNS.some((pattern) => pattern.test(cwd))) {
    return true;
  }
  return false;
}

export function deriveScope(cwd, config) {
  if (!cwd || typeof cwd !== "string") return null;
  const projects = config?.capture_projects;
  if (!projects || typeof projects !== "object") return null;

  const resolved = path.resolve(cwd);
  for (const [projectPath, meta] of Object.entries(projects)) {
    if (!meta?.enabled) continue;
    const projectResolved = path.resolve(projectPath);
    if (resolved === projectResolved || resolved.startsWith(`${projectResolved}/`)) {
      const name = path.basename(projectResolved).toLowerCase().replace(/[^a-z0-9_-]/g, "");
      return `project:${name}`;
    }
  }
  return null;
}

export function computeArm(installSalt, sessionId) {
  if (!installSalt || !sessionId) return 0;
  const mac = createHmac("sha256", String(installSalt))
    .update(String(sessionId))
    .digest();
  return mac[0] % 2;
}

function freshnessLabel(info) {
  if (!info) return "";
  if (info.freshness === "expired") return " [expired]";
  if (info.freshness === "stale") return " [stale]";
  return "";
}

export function buildIndex(home, scope, { now } = {}) {
  if (!scope || scope === "person" || scope.startsWith("person:")) {
    return { index: "", facts: [], tokens: 0 };
  }
  if (!fs.existsSync(path.join(home, "index.sqlite"))) {
    return { index: "", facts: [], tokens: 0 };
  }

  const store = new Store(home);
  try {
    const candidates = store.query({ scope, status: STATUS.ACTIVE, limit: 50 });
    if (candidates.length === 0) {
      return { index: "", facts: [], tokens: 0 };
    }

    const referenceTime = now ? new Date(now).getTime() : Date.now();
    const lines = [];
    const facts = [];
    let chars = 0;

    for (const fact of candidates) {
      const freshnessInfo = computeFreshness(fact, referenceTime);
      const date = String(fact.t_valid).slice(0, 10);
      const staleTag = freshnessLabel(freshnessInfo);
      const line = `- ${fact.id.slice(0, 8)}|${date}${staleTag}: ${topicOf(fact.claim)}`;
      if (chars + line.length > MAX_CHARS) break;
      lines.push(line);
      facts.push(fact.id);
      chars += line.length;
    }

    const index = lines.join("\n");
    return { index, facts, tokens: Math.ceil(chars / CHARS_PER_TOKEN) };
  } finally {
    store.close();
  }
}

function topicOf(claim) {
  const truncated = [...claim].slice(0, 60).join("");
  if (truncated.length < claim.length) return `${truncated}...`;
  return truncated;
}

export function buildSessionStartOutput(home, { sessionId, cwd, config } = {}) {
  if (isExcludedSession(sessionId, cwd)) {
    return { injected: false, reason: "excluded_session" };
  }

  const scope = deriveScope(cwd, config);
  if (!scope) {
    return { injected: false, reason: "no_scope" };
  }

  const installSalt = config?.telemetry?.install_id;
  const arm = computeArm(installSalt, sessionId);

  const { index, facts, tokens } = buildIndex(home, scope);
  if (facts.length === 0) {
    return { injected: false, reason: "no_facts", arm, scope };
  }

  const event = {
    ev: "session_start.index",
    session_id: sessionId,
    cwd,
    scope,
    experiment_arm: arm,
    fact_count: facts.length,
    tokens,
    at: new Date().toISOString(),
  };

  appendSessionEvent(home, event);

  if (arm === 0) {
    // Control: description only (no index injected into context)
    return {
      injected: false,
      reason: "control_arm",
      arm,
      scope,
      fact_count: facts.length,
    };
  }

  // Treatment arm: inject index
  const output = [
    `[nautli] ${scope} 기억 인덱스 (${facts.length}건):`,
    index,
    "",
    "필요하면 해당 topic으로 recall하라.",
  ].join("\n");

  // TASK-104: 실제 컨텍스트 주입(치료군)만 전달로 로깅한다 — 대조군은 로깅 없음.
  // hit = 인덱스에 실제로 렌더된 fact id들. tool 이름은 정확히 "session-start.index".
  logSessionStartDelivery(home, { sessionId, scope, facts });

  return {
    injected: true,
    arm,
    scope,
    fact_count: facts.length,
    tokens,
    output,
  };
}

// TASK-104: 세션 시작 인덱스 주입 전달을 type:"recall" 이벤트로 기록한다(§6 D5).
function logSessionStartDelivery(home, { sessionId, scope, facts }) {
  if (!Array.isArray(facts) || facts.length === 0) return;
  const store = new Store(home);
  try {
    store.appendRecall({
      tool: "session-start.index",
      query: "",
      scope,
      hits: facts,
      source: "session-start",
      session_id: sessionId,
    });
  } finally {
    store.close();
  }
}

function appendSessionEvent(home, event) {
  const eventsDir = path.join(home, "events");
  fs.mkdirSync(eventsDir, { recursive: true });
  const month = event.at.slice(0, 7);
  const file = path.join(eventsDir, `${month}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}
