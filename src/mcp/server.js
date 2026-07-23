import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BRAND } from "../brand.js";
import { remember } from "../core/gate.js";
import { briefing as buildBriefing, recall } from "../core/recall.js";
import { buildReceipt } from "../core/receipt.js";
import { undoStats } from "../core/review.js";
import { ERR, STATUS } from "../core/schema.js";
import { Store } from "../core/store.js";
import { makeT, resolveLocale } from "../i18n/strings.js";
import { findPairs } from "../daemon/pair.js";
import { runOnce } from "../daemon/pipeline.js";
import { scopeSlug } from "../daemon/render.js";
import { matchProcedures } from "../core/procedure.js";
import { digestFreshness } from "../onboard/setup.js";

const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
});

const ERROR_CODES = new Set(Object.values(ERR));
// TASK-068: recall 신규 스키마의 필수 phase enum.
const RECALL_PHASES = ["plan", "act", "verify", "handoff"];
const RECALL_PHASE_SET = new Set(RECALL_PHASES);
const DIGEST_STALE_MS = 48 * 60 * 60 * 1000;
const DIGEST_LOCK_STALE_MS = 3 * 60 * 60 * 1000;
const MAX_ON_DEMAND_PAIRS = 20;

function acquireDigestLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      if (age < DIGEST_LOCK_STALE_MS) return false;
      fs.rmSync(file, { force: true });
    }
  }
  return false;
}

function recordConsolidateJournal(home, detail) {
  const file = path.join(home, "daemon", "journal.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({
    kind: "consolidate_mcp",
    at: new Date().toISOString(),
    ...detail,
  })}\n`, "utf8");
}

// 유일하게 보장되는 유저 접점(세션 시작 briefing)에 데몬 상태를 실어 나른다 —
// 리뷰 카드·소화 상태가 대시보드를 열어야만 보이면 유저는 "못 받았다"고 느낀다.
// 노이즈 방지: 행동이 필요한 상태(카드 대기, 소화 멈춤)만 싣는다.
export function receiptHeader(receipt, t) {
  if (!receipt || receipt.activity === 0) return null;
  // Observational phrasing only — no savings claims
  if (receipt.sample_ok) {
    return t("mcp.briefing.receipt", {
      days: receipt.days,
      conversations: receipt.conversations,
      tokens: receipt.tokens_delivered,
    });
  }
  return t("mcp.briefing.receipt_building", { facts: receipt.facts_active });
}

export function daemonStatusHeader(home, t, store) {
  const lines = [];
  // Zero-touch: no cards_waiting push. Only show efficacy line.
  let stats = { total: 0, undone: 0, undo_rate: 0 };
  try {
    stats = undoStats(home);
  } catch {
    // undo ledger read failure must not break briefing
  }
  if (stats.total > 0) {
    lines.push(t("mcp.briefing.auto_cleanup", { count: stats.total, undone: stats.undone }));
  }
  const freshness = digestFreshness(home);
  if (freshness.last_success_at && freshness.age_ms > DIGEST_STALE_MS) {
    lines.push(t("mcp.briefing.digest_stale", { last: freshness.last_success_at }));
  }
  let receipt;
  try {
    receipt = buildReceipt(home, store);
    const receiptLine = receiptHeader(receipt, t);
    if (receiptLine) lines.push(receiptLine);
  } catch {
    // Receipt measurement must not prevent memory recall.
  }
  return {
    lines,
    pending: 0,
    last_digest_at: freshness.last_success_at,
    ...(receipt ? { receipt } : {}),
  };
}

function resolveHome() {
  return path.resolve(process.env.NAUTLI_HOME ?? path.join(os.homedir(), ".nautli"));
}

// TASK-014: 최신 소화 리포트(reports/YYYY-MM-DD.md)의 마크다운을 그대로 읽는다(읽기 전용).
function latestReportMarkdown(home) {
  const dir = path.join(home, "reports");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name)).sort();
  } catch {
    names = [];
  }
  if (names.length === 0) return null;
  const file = path.join(dir, names[names.length - 1]);
  return { file: names[names.length - 1], text: fs.readFileSync(file, "utf8") };
}

// TASK-014: 현재 active scope 목록 → nautli://views/{slug} 리소스 URI로 노출한다.
function activeScopeResources(store) {
  const scopes = [...new Set(store.query({ status: STATUS.ACTIVE }).map((fact) => fact.scope))].sort();
  return scopes.map((scope) => ({
    uri: `nautli://views/${scopeSlug(scope)}`,
    name: scope,
    mimeType: "text/markdown",
  }));
}

// TASK-014: 주어진 slug의 읽기 전용 뷰 마크다운. 데몬이 렌더한 파일이 있으면 그걸,
// 없으면 현재 active fact로 즉석 렌더(파생 정보라 저장하지 않는다). 매칭 scope가 없으면 null.
function viewMarkdownForSlug(store, home, slug) {
  const file = path.join(home, "views", `${slug}.md`);
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  } catch {
    // 파일 읽기 실패는 즉석 렌더로 폴백한다.
  }
  const active = store.query({ status: STATUS.ACTIVE });
  const facts = active.filter((fact) => scopeSlug(fact.scope) === slug);
  if (facts.length === 0) return null;
  const scope = facts[0].scope;
  const lines = [`# ${scope}`, ""];
  for (const fact of facts) lines.push(`- ${fact.claim}`);
  return `${lines.join("\n")}\n`;
}

function readConfig(home) {
  const file = path.join(home, "config.json");
  if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, "utf8")) };
}

function errorResult(error) {
  const code = ERROR_CODES.has(error?.code) ? error.code : ERR.E_INVALID_INPUT;
  return {
    error: code,
    message: error instanceof Error ? error.message : String(error),
  };
}

function jsonContent(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

// TASK-068: 툴/결과별 다음 기억 행동 힌트(항상 문자열).
function nextMemoryAction(toolName, payload) {
  if (payload && typeof payload === "object" && typeof payload.error === "string") {
    return "Fix the input and retry; do not fabricate memory or act as if the fact were stored.";
  }
  switch (toolName) {
    case "remember":
      if (payload?.status === "rejected") {
        return "Not stored (rejected). Reshape into one atomic durable claim, or skip if it is not memory-worthy.";
      }
      if (payload?.status === "duplicate") {
        return "Already stored — no new write needed; recall this scope before related work.";
      }
      return "Stored. Recall this scope before related work, and pass supersedes when this fact changes.";
    case "recall": {
      const empty = payload?.warning === ERR.W_EMPTY
        || (Array.isArray(payload?.facts) && payload.facts.length === 0);
      return empty
        ? "Nothing relevant found — proceed, and remember only newly verified, durable outcomes."
        : "Use the recalled facts; remember only new decisions or corrections that will matter again.";
    }
    case "briefing":
      return "Start from this context; recall for specifics and remember durable outcomes as they are confirmed.";
    case "consolidate":
      return "Review the candidates; run apply with a scope only when the user asks to clean up now.";
    case "get_applicable_procedures":
      return "Follow the highest-priority applicable procedure; if none fit, proceed normally.";
    default:
      return "Recall before related work; remember only durable, verified facts.";
  }
}

// TASK-068: 모든 nautli 툴의 성공/에러 페이로드에 문자열 next_memory_action을 붙이는 중앙 래퍼.
function withNextAction(toolName, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (typeof payload.next_memory_action !== "string") {
    payload.next_memory_action = nextMemoryAction(toolName, payload);
  }
  return payload;
}

function safe(toolName, handler) {
  return async (input) => {
    try {
      return jsonContent(withNextAction(toolName, await handler(input)));
    } catch (error) {
      return jsonContent(withNextAction(toolName, errorResult(error)));
    }
  };
}

export function createServer(store, config) {
  const server = new McpServer({ name: BRAND, version: "0.2.1" });

  server.registerTool("remember", {
    description: "Store one durable, verified fact for future conversations. When the user explicitly asks you to remember something, or a stable decision, preference, workflow, verified lesson, or project state has just been established and is likely to matter again, call this after it is confirmed. Store one atomic claim with the narrowest applicable scope and appropriate type. Do not store secrets, small talk, speculation, unverified conclusions, transient progress, raw conversation summaries, or information already represented by an existing fact. Use supersedes when replacing an older fact.",
    inputSchema: {
      claim: z.string(),
      type: z.enum(["episodic", "semantic", "procedural"]).optional(),
      scope: z.string().optional(),
      subject: z.string().optional(),
      supersedes: z.string().optional(),
      t_valid: z.string().optional(),
      confidence: z.number().optional(),
    },
  }, safe("remember", (input) => remember(store, { ...input, source: "mcp" }, config)));

  server.registerTool("recall", {
    // TASK-068: 소비 정책을 설명에 명시한다.
    description: "Search durable memories for facts relevant to the current task. Policy: 선호·이력·반복 workflow·이전 정정에 의존할 때는 답변 전에 조회하고, 불확실하면 abstain(추측 금지). Pass current_intent (what you are about to do) and phase (plan|act|verify|handoff) with the narrowest scope. Do not call for self-contained questions, facts already in the conversation or repository, or when prior context cannot change the result. Check freshness markers and never treat memories from an unrelated project as current facts.",
    inputSchema: {
      // 신규 스키마(엄격): current_intent + phase + scope.
      current_intent: z.string().optional(),
      phase: z.enum(["plan", "act", "verify", "handoff"]).optional(),
      // ORCHESTRATOR DEVIATION: 레거시 task는 current_intent의 별칭으로 계속 받는다(이 머신의 라이브 세션).
      task: z.string().optional(),
      budget_tokens: z.number().int().optional(),
      scope: z.string().optional(),
      as_of: z.string().optional(),
      // TASK-104: 클라이언트 세션 식별자를 전파(§6 D1) — 없으면 코어가 "unknown"으로 기록.
      session_id: z.string().optional(),
    },
  }, safe("recall", ({ current_intent, phase, task, ...options }) => {
    const invalid = (message) => ({ error: ERR.E_INVALID_INPUT, message });
    let intent;
    let deprecation;
    if (current_intent !== undefined) {
      // 신규 스키마는 엄격하게 검증한다: current_intent + phase + scope 모두 필수.
      if (typeof current_intent !== "string" || current_intent.trim() === "") {
        return invalid("current_intent must be a non-empty string");
      }
      if (typeof options.scope !== "string" || options.scope.trim() === "") {
        return invalid("scope is required with current_intent");
      }
      if (!RECALL_PHASE_SET.has(phase)) {
        return invalid(`phase is required and must be one of ${RECALL_PHASES.join("|")}`);
      }
      intent = current_intent;
    } else {
      // 레거시 스키마: task를 intent로, phase는 선택(기본 act). _deprecation 노트만 남기고 실패하지 않는다.
      if (typeof task !== "string" || task.trim() === "") {
        return invalid("current_intent (or legacy task) is required");
      }
      intent = task;
      deprecation = "recall({task}) is deprecated; pass current_intent and phase (plan|act|verify|handoff).";
    }
    const result = recall(store, intent, { ...options, source: "mcp" });
    if (deprecation) result._deprecation = deprecation;
    return result;
  }));

  server.registerTool("briefing", {
    description: "Get compact starting context from durable memory for a new or resumed task. When beginning a top-level conversation or resuming work and relevant user or project context is not already available, call this before planning or answering. Provide the current context and the narrowest applicable scope. Do not call in short-lived subagents, daemons, tests, or self-contained sessions, and do not call again in the same session unless the task or scope materially changes. Treat stale or expired items cautiously.",
    inputSchema: {
      context: z.string().optional(),
      scope: z.string().optional(),
      // TASK-104: 브리핑 전달 세션 식별자 전파(§6 D1).
      session_id: z.string().optional(),
    },
  }, safe("briefing", ({ context, scope, session_id }) => {
    const result = buildBriefing(store, context, scope, { ...config, source: "mcp", session_id });
    const t = makeT(resolveLocale());
    const status = daemonStatusHeader(store.home, t, store);
    if (status.lines.length > 0) {
      result.briefing = [status.lines.join("\n"), result.briefing].filter(Boolean).join("\n\n");
    }
    result.review_pending = status.pending;
    if (status.last_digest_at) result.last_digest_at = status.last_digest_at;
    return result;
  }));

  server.registerTool("consolidate", {
    description: "Run on-demand memory consolidation (deduplication and contradiction resolution). By default runs in dry_run mode, returning candidate pairs and expected changes without modifying anything. Pass apply=true with a scope to execute. Only call when the user explicitly asks to consolidate or clean up memories now, not routinely.",
    inputSchema: {
      apply: z.boolean().optional(),
      scope: z.string().optional(),
      subject: z.string().optional(),
      max_pairs: z.number().int().optional(),
    },
  }, safe("consolidate", async (input) => {
    const dry = !input.apply;
    const lockFile = path.join(store.home, "daemon", "run.lock");

    if (!dry && !input.scope) {
      return {
        error: ERR.E_INVALID_INPUT,
        message: "apply=true requires a scope to limit blast radius. Use scope (e.g. 'person', 'project:nautli').",
      };
    }

    if (!acquireDigestLock(lockFile)) {
      return {
        error: ERR.E_STORE_BUSY,
        message: "Digest is already running (daemon or another consolidate call). Try again later.",
      };
    }

    try {
      const pairOpts = {};
      if (input.scope) pairOpts.scope = input.scope;
      if (input.subject) pairOpts.subject = input.subject;
      const maxPairs = Math.min(input.max_pairs ?? MAX_ON_DEMAND_PAIRS, MAX_ON_DEMAND_PAIRS);

      if (dry) {
        // dry_run: findPairs only — no pipeline/capture side-effects
        const allPairs = findPairs(store, pairOpts);
        const candidates = allPairs.slice(0, maxPairs).map(({ a, b, sim }) => ({
          pair_id: `${a.id}:${b.id}`,
          claim_a: a.claim,
          claim_b: b.claim,
          scope: a.scope,
          subject_a: a.subject,
          subject_b: b.subject,
          similarity: Math.round(sim * 100) / 100,
        }));

        recordConsolidateJournal(store.home, {
          mode: "dry_run",
          scope: input.scope ?? null,
          subject: input.subject ?? null,
          candidates: candidates.length,
        });

        return {
          dry_run: true,
          candidates,
          total_pairs: allPairs.length,
        };
      }

      const result = await runOnce(store, store.home, config, {
        scope: input.scope,
        subject: input.subject,
      });

      recordConsolidateJournal(store.home, {
        mode: "apply",
        scope: input.scope,
        subject: input.subject ?? null,
        pairs: result.pairs,
        judgments: result.judgments,
        merged: result.merged,
        superseded: result.superseded,
      });

      return {
        applied: true,
        scope: input.scope,
        pairs: result.pairs,
        judgments: result.judgments,
        merged: result.merged ?? 0,
        superseded: result.superseded ?? 0,
        judge_errors: result.judge_errors?.length ?? 0,
      };
    } finally {
      fs.rmSync(lockFile, { force: true });
    }
  }));

  // TASK-067: 절차 발동 라우터 — 현재 intent/scope에 발동해야 할 active procedure fact를 우선순위로.
  server.registerTool("get_applicable_procedures", {
    description: "List procedure memories whose triggers apply to the current intent and scope, ranked by priority. Call when about to start a task to surface repeatable workflows the user has established. Returns only active procedure-scope facts whose trigger targets match (and whose excludes do not).",
    inputSchema: {
      current_intent: z.string(),
      scope: z.string().optional(),
      tool_event: z.string().optional(),
    },
  }, safe("get_applicable_procedures", ({ current_intent, scope, tool_event }) => {
    const candidates = typeof store.listProcedureTriggers === "function"
      ? store.listProcedureTriggers()
      : [];
    const procedures = matchProcedures(candidates, { current_intent, scope, tool_event });
    return { procedures };
  }));

  // TASK-014: 읽기 전용 리소스 3종 — 최신 리포트(Markdown), 통계(JSON), scope별 뷰(템플릿).
  server.registerResource(
    "reports-latest",
    "nautli://reports/latest",
    {
      title: "Latest digest report",
      description: "The most recent daily consolidation report as Markdown.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const latest = latestReportMarkdown(store.home);
      const text = latest
        ? latest.text
        : "# nautli\n\n아직 생성된 소화 리포트가 없습니다.\n";
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "stats",
    "nautli://stats",
    {
      title: "Memory statistics",
      description: "Fact counts by status and scope (read-only JSON).",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(store.stats()),
      }],
    }),
  );

  server.registerResource(
    "views",
    new ResourceTemplate("nautli://views/{scope}", {
      // 실제 active scope들의 URI를 열거한다(빈 목록도 유효).
      list: async () => ({ resources: activeScopeResources(store) }),
    }),
    {
      title: "Read-only scope views",
      description: "Generated read-only Markdown view for one active scope.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const raw = variables?.scope;
      const slug = Array.isArray(raw) ? raw[0] : raw;
      const text = viewMarkdownForSlug(store, store.home, String(slug ?? ""));
      if (text === null) {
        const error = new Error(`no active view for scope '${slug}'`);
        error.code = ERR.E_NOT_FOUND;
        throw error;
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  // TASK-014: `remember-well` 프롬프트 — 좋은 fact 저장을 위한 가이드 메시지를 만든다.
  server.registerPrompt(
    "remember-well",
    {
      title: "Remember a fact well",
      description: "Guidance for storing one durable, atomic memory with the right scope.",
      argsSchema: {
        claim: z.string(),
        scope: z.string().optional(),
        source_context: z.string().optional(),
      },
    },
    ({ claim, scope, source_context }) => {
      const scopeLine = scope
        ? `Proposed scope: ${scope}`
        : "Proposed scope: (none — choose the narrowest of person / procedure / project:<name>)";
      const contextLine = source_context
        ? `Where it came from: ${source_context}`
        : "Where it came from: (unspecified)";
      const text = [
        "You are about to store a durable memory with the nautli `remember` tool.",
        "",
        `Candidate claim: ${claim}`,
        scopeLine,
        contextLine,
        "",
        "Before storing, verify:",
        "- It is ONE atomic fact (split compound statements; no lists).",
        "- It is durable and likely to matter again (not small talk, speculation, or transient progress).",
        "- The scope is the narrowest that fits: person for personal preferences, procedure for cross-project workflows, project:<name> for one project.",
        "- It is not already represented by an existing fact (recall first). If it replaces an older fact, pass that fact id as `supersedes`.",
        "- No secrets, credentials, or tokens.",
        "",
        "If it passes, call `remember` with the atomic claim and chosen scope. If not, do not store it.",
      ].join("\n");
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    },
  );

  return server;
}

export async function startServer(home = resolveHome()) {
  const store = new Store(home);
  const config = readConfig(home);
  const server = createServer(store, config);
  server.server.onclose = () => store.close();

  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    store.close();
    throw error;
  }
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  startServer().catch((error) => {
    process.stderr.write(`${JSON.stringify(errorResult(error))}\n`);
    process.exitCode = 1;
  });
}
