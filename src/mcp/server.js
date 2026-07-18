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
import { listSurfacedCards, undoStats } from "../core/review.js";
import { ERR } from "../core/schema.js";
import { Store } from "../core/store.js";
import { makeT, resolveLocale } from "../i18n/strings.js";
import { digestFreshness } from "../onboard/setup.js";

const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
});

const ERROR_CODES = new Set(Object.values(ERR));
const DIGEST_STALE_MS = 48 * 60 * 60 * 1000;

// 유일하게 보장되는 유저 접점(세션 시작 briefing)에 데몬 상태를 실어 나른다 —
// 리뷰 카드·소화 상태가 대시보드를 열어야만 보이면 유저는 "못 받았다"고 느낀다.
// 노이즈 방지: 행동이 필요한 상태(카드 대기, 소화 멈춤)만 싣는다.
export function receiptHeader(receipt, t) {
  if (!receipt || receipt.activity === 0) return null;
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
    inputSchema: {
      task: z.string(),
      budget_tokens: z.number().int().optional(),
      scope: z.string().optional(),
      as_of: z.string().optional(),
    },
  }, safe(({ task, ...options }) => recall(store, task, { ...options, source: "mcp" })));

  server.registerTool("briefing", {
    inputSchema: {
      context: z.string().optional(),
      scope: z.string().optional(),
    },
  }, safe(({ context, scope }) => {
    const result = buildBriefing(store, context, scope, { ...config, source: "mcp" });
    const t = makeT(resolveLocale());
    const status = daemonStatusHeader(store.home, t, store);
    if (status.lines.length > 0) {
      result.briefing = [status.lines.join("\n"), result.briefing].filter(Boolean).join("\n\n");
    }
    result.review_pending = status.pending;
    if (status.last_digest_at) result.last_digest_at = status.last_digest_at;
    return result;
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
