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
import { ERR } from "../core/schema.js";
import { Store } from "../core/store.js";

const DEFAULT_CONFIG = Object.freeze({
  default_scope: "person",
  judge_cmd: null,
});

const ERROR_CODES = new Set(Object.values(ERR));

function resolveHome() {
  return path.resolve(process.env.NIGHTMERGE_HOME ?? path.join(os.homedir(), ".nightmerge"));
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
  const server = new McpServer({ name: BRAND, version: "0.1.0" });

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
  }, safe((input) => remember(store, input, config)));

  server.registerTool("recall", {
    inputSchema: {
      task: z.string(),
      budget_tokens: z.number().int().optional(),
      scope: z.string().optional(),
      as_of: z.string().optional(),
    },
  }, safe(({ task, ...options }) => recall(store, task, options)));

  server.registerTool("briefing", {
    inputSchema: {
      context: z.string().optional(),
      scope: z.string().optional(),
    },
  }, safe(({ context, scope }) => buildBriefing(store, context, scope, config)));

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
