import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BRAND } from "../brand.js";
import { remember } from "../core/gate.js";
import { briefing as buildBriefing, recall } from "../core/recall.js";
import { buildReceipt } from "../core/receipt.js";
import { undoStats } from "../core/review.js";
import { ERR } from "../core/schema.js";
import { Store } from "../core/store.js";
import { makeT, resolveLocale } from "../i18n/strings.js";
import { findPairs } from "../daemon/pair.js";
import { runOnce } from "../daemon/pipeline.js";
import { digestFreshness } from "../onboard/setup.js";

const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
});

const ERROR_CODES = new Set(Object.values(ERR));
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

function safe(handler) {
  return async (input) => {
    try {
      return jsonContent(await handler(input));
    } catch (error) {
      return jsonContent(errorResult(error));
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
  }, safe((input) => remember(store, { ...input, source: "mcp" }, config)));

  server.registerTool("recall", {
    description: "Search durable memories for facts relevant to the current task. When a past decision, preference, workflow, project state, or prior outcome could affect the answer and is not already clear in the current context, call this before answering or acting. Pass a concise description of the task and the narrowest applicable scope. Do not call for self-contained questions, facts already available in the current conversation or repository, or when prior context cannot change the result. Check freshness markers and never treat memories from an unrelated project as current facts.",
    inputSchema: {
      task: z.string(),
      budget_tokens: z.number().int().optional(),
      scope: z.string().optional(),
      as_of: z.string().optional(),
      // TASK-104: 클라이언트 세션 식별자를 전파(§6 D1) — 없으면 코어가 "unknown"으로 기록.
      session_id: z.string().optional(),
    },
  }, safe(({ task, ...options }) => recall(store, task, { ...options, source: "mcp" })));

  server.registerTool("briefing", {
    description: "Get compact starting context from durable memory for a new or resumed task. When beginning a top-level conversation or resuming work and relevant user or project context is not already available, call this before planning or answering. Provide the current context and the narrowest applicable scope. Do not call in short-lived subagents, daemons, tests, or self-contained sessions, and do not call again in the same session unless the task or scope materially changes. Treat stale or expired items cautiously.",
    inputSchema: {
      context: z.string().optional(),
      scope: z.string().optional(),
      // TASK-104: 브리핑 전달 세션 식별자 전파(§6 D1).
      session_id: z.string().optional(),
    },
  }, safe(({ context, scope, session_id }) => {
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
  }, safe(async (input) => {
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
