import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recall } from "../core/recall.js";
import { remember } from "../core/gate.js";
import { applyCaptureCard, applyCard, listCards } from "../core/review.js";
import { ERR } from "../core/schema.js";
import { Store } from "../core/store.js";
import { checkClaudeLogin, doctor } from "../onboard/doctor.js";
import {
  checkClaudeStatus,
  checkCodexStatus,
  initStore,
  installDaemon,
  installInstructions,
  readConfig,
  registerMcp,
  registerMcpCodex,
  removeInstructions,
  removeSampleFacts,
  seedSampleFacts,
  statusAll,
  uninstallDaemon,
  writeConfig,
} from "../onboard/setup.js";
import {
  SCAN_VERSION,
  detectAgents,
  readScanCache,
  rememberedCount,
  scanUsage,
  writeScanCache,
} from "../onboard/scan.js";
import {
  checkupCandidates,
  checkupPreflight,
  checkupStatus,
  dismissCheckup,
  importCheckup,
  readCheckupReport,
  startCheckup,
} from "../onboard/checkup.js";
import { HTML } from "./public.js";

const CLI_FILE = fileURLToPath(new URL("../cli.js", import.meta.url));
const BODY_LIMIT = 64 * 1024;
const SCAN_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const scanFlights = new Map();

const HUMAN_ERRORS = Object.freeze({
  [ERR.E_INVALID_INPUT]: "입력 내용을 확인해 주세요.",
  [ERR.E_MULTI_FACT]: "한 번에 한 가지 기억만 추가해 주세요.",
  [ERR.E_CLAIM_TOO_LONG]: "기억은 280자 이내로 적어 주세요.",
  [ERR.E_UNKNOWN_SCOPE]: "scope는 개인, 절차 또는 project:이름 형식이어야 해요.",
  [ERR.E_NOT_FOUND]: "대상을 찾을 수 없어요. 상태를 새로고침해 주세요.",
  [ERR.E_STORE_BUSY]: "기억 저장소가 사용 중이에요. 잠시 후 다시 시도해 주세요.",
  [ERR.E_BUDGET_TOO_SMALL]: "검색 예산이 너무 작아요.",
  [ERR.E_CLAUDE_CLI_MISSING]: "Claude CLI가 설치되어 있지 않아요.",
  [ERR.E_CODEX_CLI_MISSING]: "Codex CLI가 설치되어 있지 않아요.",
  [ERR.E_MCP_REGISTER_FAILED]: "Claude MCP 자동 등록에 실패했어요.",
  [ERR.E_LAUNCHCTL_FAILED]: "밤 소화 데몬 등록에 실패했어요.",
  [ERR.E_EXTRACT_FAILED]: "대화에서 기억 후보를 뽑지 못했어요.",
  [ERR.W_DUPLICATE]: "이미 같은 기억이 저장되어 있어요.",
});

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function errorCode(error) {
  return Object.values(ERR).includes(error?.code)
    ? error.code
    : ERR.E_INVALID_INPUT;
}

function fail(response, status, error) {
  const code = errorCode(error);
  const manualMessage = typeof error?.manual_command === "string"
    && error?.message
    && error.message !== code
    ? error.message
    : null;

  json(response, status, {
    error: code,
    message: manualMessage
      || HUMAN_ERRORS[code]
      || (
        error?.message && error.message !== code
          ? error.message
          : "요청을 처리하지 못했어요."
      ),
    ...(typeof error?.manual_command === "string"
      ? { manual_command: error.manual_command }
      : {}),
  });
}

async function bodyJson(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error(ERR.E_INVALID_INPUT);
      error.code = ERR.E_INVALID_INPUT;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    const error = new Error(ERR.E_INVALID_INPUT, { cause });
    error.code = ERR.E_INVALID_INPUT;
    throw error;
  }
}

function statsFor(home) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) {
    return { total: 0, byStatus: {}, byScope: {} };
  }

  const store = new Store(home);
  try {
    return store.stats();
  } finally {
    store.close();
  }
}

function cardFacts(store, card) {
  if (card.type === "capture") return { ...card, facts: null };
  const [aId, bId] = card.pair_id.split(":");
  return {
    ...card,
    facts: {
      a: store.getFact(aId),
      b: store.getFact(bId),
    },
  };
}

function cardsFor(home) {
  const cards = listCards(home);
  if (
    cards.length === 0
    || !fs.existsSync(path.join(home, "index.sqlite"))
  ) {
    return cards;
  }

  const store = new Store(home);
  try {
    return cards.map((card) => cardFacts(store, card));
  } finally {
    store.close();
  }
}

function memoryFor(home, searchParams) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) {
    return {
      briefing: "",
      facts: [],
      tokens_used: 0,
      warning: ERR.W_EMPTY,
    };
  }

  const store = new Store(home);
  try {
    const scope = searchParams.get("scope") || undefined;
    const includeDead = ["1", "true"].includes(
      (searchParams.get("includeDead") ?? "").toLocaleLowerCase(),
    );
    const result = recall(store, searchParams.get("q") ?? "", {
      scope,
      include_archived: includeDead,
      source: "dashboard",
    });
    const byId = new Map(result.facts.map((fact) => [fact.id, fact]));

    if (includeDead) {
      const query = (searchParams.get("q") ?? "")
        .trim()
        .toLocaleLowerCase();
      for (const fact of store.query({ scope })) {
        if (fact.status === "active") continue;
        if (
          query !== ""
          && !fact.claim.toLocaleLowerCase().includes(query)
        ) {
          continue;
        }
        byId.set(fact.id, fact);
      }
    }

    const allFacts = store.query({ scope });
    const supersedes = new Map();
    for (const fact of allFacts) {
      if (!fact.superseded_by) continue;
      const current = supersedes.get(fact.superseded_by) ?? [];
      current.push(fact.id);
      supersedes.set(fact.superseded_by, current);
    }

    return {
      ...result,
      facts: [...byId.keys()]
        .map((id) => store.getFact(id))
        .filter(Boolean)
        .map((fact) => ({
          ...fact,
          supersedes: supersedes.get(fact.id) ?? [],
        })),
    };
  } finally {
    store.close();
  }
}

function activityFor(home, searchParams) {
  if (!fs.existsSync(path.join(home, "events"))) {
    return { events: [] };
  }

  const store = new Store(home);
  try {
    const since = searchParams.has("since")
      ? searchParams.get("since")
      : undefined;
    return { events: store.activity({ since }) };
  } finally {
    store.close();
  }
}

function continuityRecallFor(home, factId) {
  if (
    typeof factId !== "string"
    || factId.trim() === ""
    || !fs.existsSync(path.join(home, "index.sqlite"))
  ) {
    const error = new Error(ERR.E_NOT_FOUND);
    error.code = ERR.E_NOT_FOUND;
    throw error;
  }

  const store = new Store(home);
  try {
    const fact = store.getFact(factId);
    if (!fact) {
      const error = new Error(ERR.E_NOT_FOUND);
      error.code = ERR.E_NOT_FOUND;
      throw error;
    }

    const result = recall(store, fact.claim, {
      scope: fact.scope,
      source: "dashboard",
    });
    if (!result.facts.some((candidate) => candidate.id === fact.id)) {
      const error = new Error(ERR.E_NOT_FOUND);
      error.code = ERR.E_NOT_FOUND;
      throw error;
    }

    return {
      fact: {
        id: fact.id,
        claim: fact.claim,
        scope: fact.scope,
      },
    };
  } finally {
    store.close();
  }
}

function shareCardFor(home) {
  const status = checkupStatus(home);
  if (status.state !== "done" && status.state !== "imported") {
    const error = new Error(ERR.E_NOT_FOUND);
    error.code = ERR.E_NOT_FOUND;
    throw error;
  }

  const summary = status.summary ?? {};
  const sampledNotes = Number.isFinite(status.files_sampled)
    ? status.files_sampled
    : Number(summary.notes ?? 0);
  let minutes = null;

  try {
    const current = JSON.parse(
      fs.readFileSync(path.join(home, "checkup", "current.json"), "utf8"),
    );
    const startedAt = Date.parse(current.started_at);
    const completedAt = fs.statSync(
      path.join(current.run_dir, "summary.json"),
    ).mtimeMs;
    if (Number.isFinite(startedAt) && completedAt >= startedAt) {
      minutes = Math.max(
        1,
        Math.ceil((completedAt - startedAt) / 60_000),
      );
    }
  } catch {
    // 이전 리포트에는 시간 메타데이터가 없을 수 있어 표본 기반 예상값을 쓴다.
  }

  return {
    contradictions: Number(summary.contradictions ?? 0),
    duplicates: Number(summary.duplicates ?? 0),
    junk_percent: summary.junk_rate == null
      ? null
      : Math.round(Number(summary.junk_rate) * 100),
    sampled_notes: sampledNotes,
    minutes: minutes
      ?? Math.max(
        1,
        Math.ceil(Math.min(sampledNotes, 40) / 30 * 8),
      ),
    score: Number(summary.score ?? 0),
    cta: "What's hiding in yours? npx nautli dashboard",
  };
}

function cursorStatus(userHome) {
  const file = path.join(userHome, ".cursor", "mcp.json");
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const entry = config?.mcpServers?.nautli;
    return {
      complete: Boolean(
        entry
        && entry.command === "nautli"
        && Array.isArray(entry.args)
        && entry.args.includes("mcp")
      ),
      available: true,
    };
  } catch {
    return { complete: false, available: true };
  }
}

function graphScopeLabel(scope) {
  if (scope === "person") return "개인";
  if (scope === "procedure") return "절차";
  return String(scope ?? "").replace(/^project:/u, "프로젝트 ");
}

function graphFor(home) {
  if (!fs.existsSync(path.join(home, "index.sqlite"))) {
    return { nodes: [], links: [] };
  }

  const store = new Store(home);
  try {
    const active = store.query({ status: "active", limit: 601 });
    const truncated = active.length > 600;
    const selected = active.slice(0, 600);
    const facts = new Map(selected.map((fact) => [fact.id, fact]));
    const links = [];
    const linkKeys = new Set();

    const addLink = (a, b, kind) => {
      if (!facts.has(a) || !facts.has(b)) return;
      const key = `${a}\u0000${b}\u0000${kind}`;
      if (linkKeys.has(key)) return;
      linkKeys.add(key);
      links.push({ a, b, kind });
    };

    for (const fact of store.query()) {
      if (!fact.superseded_by || !facts.has(fact.superseded_by)) {
        continue;
      }
      facts.set(fact.id, fact);
      addLink(fact.id, fact.superseded_by, "supersedes");
    }

    for (const card of listCards(home)) {
      if (
        card.verdict !== "contradiction"
        && card.verdict !== "duplicate"
      ) {
        continue;
      }
      const [a, b] = card.pair_id.split(":");
      addLink(a, b, card.verdict);
    }

    const scopes = [
      ...new Set([...facts.values()].map((fact) => fact.scope)),
    ];
    const nodes = [
      ...scopes.map((scope) => ({
        id: `scope:${scope}`,
        kind: "scope",
        label: graphScopeLabel(scope),
        scope,
        status: "active",
      })),
      ...[...facts.values()].map((fact) => ({
        id: fact.id,
        kind: "fact",
        label: fact.claim.slice(0, 60),
        scope: fact.scope,
        status: fact.status,
      })),
    ];

    for (const fact of facts.values()) {
      links.push({
        a: fact.id,
        b: `scope:${fact.scope}`,
        kind: "scope",
      });
    }

    return {
      nodes,
      links,
      ...(truncated ? { truncated: true } : {}),
    };
  } finally {
    store.close();
  }
}

function runDigestInChild(home) {
  const child = spawn(process.execPath, [CLI_FILE, "daemon-run"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NAUTLI_HOME: home },
  });
  child.unref();
  return {
    ok: true,
    started: true,
    pid: child.pid,
  };
}

function openBrowser(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", url]
    : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function scanFailure(error) {
  void error;
  return {
    ok: false,
    reason: "AI 사용량을 감지하지 못했어요. 다시 시도해 주세요.",
  };
}

function scanGetResult(home, agents) {
  const config = readConfig(home);
  const cache = readScanCache(home);
  const optedIn = Boolean(config.usage_scan_opted_in_at);
  const scannedAt = Date.parse(cache?.scanned_at);
  return {
    ok: true,
    version: SCAN_VERSION,
    scanned_at: cache?.scanned_at ?? null,
    stale: optedIn
      && Number.isFinite(scannedAt)
      && Date.now() - scannedAt > SCAN_CACHE_TTL_MS,
    partial: cache?.partial === true,
    capped: cache?.capped === true,
    agents,
    usage: optedIn
      ? cache?.usage ?? null
      : null,
    remembered: rememberedCount(home),
  };
}

function scanOnce(home, {
  detectAgentsFor,
  runner,
  scanUsageFor,
  userHome,
}) {
  const existing = scanFlights.get(home);
  if (existing) return existing;

  const flight = (async () => {
    const config = readConfig(home);
    const optedInAt = config.usage_scan_opted_in_at
      ?? new Date().toISOString();
    writeConfig(home, {
      usage_scan_opted_in_at: optedInAt,
    });

    const [agents, usageResult] = await Promise.all([
      detectAgentsFor({ runner }),
      scanUsageFor({ userHome }),
    ]);
    const cache = writeScanCache(home, {
      scanned_at: new Date().toISOString(),
      partial: usageResult.partial === true,
      capped: usageResult.capped === true,
      agents,
      usage: {
        claude_sessions30d:
          usageResult.claude_sessions30d,
        codex_sessions30d:
          usageResult.codex_sessions30d,
      },
      remembered: rememberedCount(home),
    });

    return {
      ok: true,
      ...cache,
    };
  })();

  scanFlights.set(home, flight);
  const clear = () => {
    if (scanFlights.get(home) === flight) scanFlights.delete(home);
  };
  flight.then(clear, clear);
  return flight;
}

export function createDashboardServer(home, options = {}) {
  const userHome = options.userHome ?? os.homedir();
  const runner = options.runner;
  const detectAgentsFor = options.detectAgents ?? detectAgents;
  const scanUsageFor = options.scanUsage ?? scanUsage;
  const statusCacheTtl = 60 * 1000;
  let claudeCache = null;
  let claudeRefresh = null;
  let codexCache = null;
  let codexRefresh = null;
  let server;

  function refreshClaudeStatus() {
    if (claudeRefresh) return;
    claudeRefresh = checkClaudeStatus(runner)
      .then((value) => {
        claudeCache = {
          value,
          expiresAt: Date.now() + statusCacheTtl,
        };
      })
      .catch(() => {
        claudeCache = {
          value: {
            cli_exists: false,
            registered: false,
          },
          expiresAt: Date.now() + statusCacheTtl,
        };
      })
      .finally(() => {
        claudeRefresh = null;
      });
  }

  function refreshCodexStatus() {
    if (codexRefresh) return;
    codexRefresh = checkCodexStatus(runner)
      .then((value) => {
        codexCache = {
          value,
          expiresAt: Date.now() + statusCacheTtl,
        };
      })
      .catch(() => {
        codexCache = {
          value: {
            cli_exists: false,
            registered: false,
          },
          expiresAt: Date.now() + statusCacheTtl,
        };
      })
      .finally(() => {
        codexRefresh = null;
      });
  }

  const handler = async (request, response) => {
    const address = server.address();
    const port = typeof address === "object" && address
      ? address.port
      : options.port ?? 4600;
    const allowedOrigins = new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ]);
    const allowedHosts = new Set([
      `127.0.0.1:${port}`,
      `localhost:${port}`,
    ]);
    const url = new URL(
      request.url ?? "/",
      `http://127.0.0.1:${port}`,
    );

    if (!allowedHosts.has(request.headers.host)) {
      json(response, 403, {
        error: "E_HOST_FORBIDDEN",
        message: "이 컴퓨터의 대시보드 요청만 처리할 수 있어요.",
      });
      return;
    }

    if (
      request.method === "POST"
      && !allowedOrigins.has(request.headers.origin)
    ) {
      json(response, 403, {
        error: "E_ORIGIN_FORBIDDEN",
        message: "이 대시보드에서 보낸 요청만 처리할 수 있어요.",
      });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(HTML),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        response.end(HTML);
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/status"
      ) {
        const cachedClaude = claudeCache?.expiresAt > Date.now()
          ? claudeCache.value
          : null;
        const cachedCodex = codexCache?.expiresAt > Date.now()
          ? codexCache.value
          : null;
        const setupOptions = {
          userHome,
          runner,
          checkClaude: false,
          checkCodex: false,
        };
        if (cachedClaude) setupOptions.claude = cachedClaude;
        if (cachedCodex) setupOptions.codex = cachedCodex;

        const setup = statusAll(home, setupOptions);
        setup.optional.cursor = cursorStatus(userHome);
        const diagnosis = doctor(home, { setup });
        const stats = statsFor(home);
        const pending = listCards(home).length;

        json(response, 200, {
          setup,
          doctor: diagnosis.result,
          stats,
          pending,
        });

        if (!cachedClaude) refreshClaudeStatus();
        if (!cachedCodex) refreshCodexStatus();
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/scan"
      ) {
        try {
          const agents = await detectAgentsFor({ runner });
          json(response, 200, scanGetResult(home, agents));
        } catch (error) {
          json(response, 200, scanFailure(error));
        }
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/scan"
      ) {
        try {
          json(response, 200, await scanOnce(home, {
            detectAgentsFor,
            runner,
            scanUsageFor,
            userHome,
          }));
        } catch (error) {
          json(response, 200, scanFailure(error));
        }
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/star-nag-seen"
      ) {
        const config = readConfig(home);
        const existing = config.star_nag_shown_at;
        if (existing) {
          json(response, 200, {
            ok: true,
            recorded: false,
            star_nag_shown_at: existing,
          });
          return;
        }

        const shownAt = new Date().toISOString();
        writeConfig(home, {
          star_nag_shown_at: shownAt,
        });
        json(response, 200, {
          ok: true,
          recorded: true,
          star_nag_shown_at: shownAt,
        });
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/instructions/preview"
      ) {
        json(
          response,
          200,
          installInstructions(home, {
            userHome,
            previewOnly: true,
          }),
        );
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/cards"
      ) {
        json(response, 200, { cards: cardsFor(home) });
        return;
      }

      if (
        request.method === "POST"
        && url.pathname.startsWith("/api/cards/")
      ) {
        const pairId = decodeURIComponent(
          url.pathname.slice("/api/cards/".length),
        );
        const input = await bodyJson(request);
        const store = new Store(home);
        try {
          const card = listCards(home).find((entry) => entry.pair_id === pairId);
          const result = card?.type === "capture"
            ? applyCaptureCard(store, home, pairId, input.action, readConfig(home))
            : applyCard(store, home, pairId, input.action, input.extraText);
          json(response, 200, result);
        } finally {
          store.close();
        }
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/memory"
      ) {
        json(response, 200, memoryFor(home, url.searchParams));
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/activity"
      ) {
        json(response, 200, activityFor(home, url.searchParams));
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/continuity/recall"
      ) {
        const input = await bodyJson(request);
        json(
          response,
          200,
          continuityRecallFor(home, input.fact_id),
        );
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/graph"
      ) {
        json(response, 200, graphFor(home));
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/memory"
      ) {
        const input = await bodyJson(request);
        const store = new Store(home);
        try {
          const result = remember(store, {
            claim: input.claim,
            scope: input.scope,
            source: "dashboard",
          }, readConfig(home));

          if (result.status !== "added") {
            const error = new Error(result.reason);
            error.code = result.reason;
            fail(response, 400, error);
          } else {
            json(response, 201, result);
          }
        } finally {
          store.close();
        }
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/checkup/candidates"
      ) {
        json(response, 200, {
          candidates: checkupCandidates({ userHome }),
        });
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/checkup/preflight"
      ) {
        json(
          response,
          200,
          checkupPreflight(
            home,
            url.searchParams.get("path"),
            { userHome, runner },
          ),
        );
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/checkup/preflight"
      ) {
        const input = await bodyJson(request);
        json(
          response,
          200,
          checkupPreflight(home, input.path, {
            userHome,
            runner,
            excludedDirs: input.excluded_dirs,
          }),
        );
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/checkup/status"
      ) {
        json(response, 200, checkupStatus(home));
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/checkup/report"
      ) {
        json(response, 200, readCheckupReport(home));
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/api/checkup/share-card"
      ) {
        json(response, 200, shareCardFor(home));
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/checkup/start"
      ) {
        const input = await bodyJson(request);
        const preflight = checkupPreflight(home, input.path, {
          userHome,
          runner,
          excludedDirs: input.excluded_dirs,
        });

        if (!preflight.python3.available) {
          throw Object.assign(
            new Error(
              "python3가 필요해요. macOS는 xcode-select --install 로 설치할 수 있어요.",
            ),
            { code: ERR.E_INVALID_INPUT },
          );
        }

        if (!preflight.claude.cli_exists) {
          throw Object.assign(
            new Error("Claude CLI를 설치한 뒤 로그인해 주세요."),
            {
              code: ERR.E_CLAUDE_CLI_MISSING,
              manual_command:
                "npm install -g @anthropic-ai/claude-code && claude",
            },
          );
        }

        if (!preflight.claude.logged_in) {
          throw Object.assign(
            new Error(
              "Claude CLI 로그인이 필요해요. 터미널에서 claude를 실행해 로그인해 주세요.",
            ),
            {
              code: ERR.E_INVALID_INPUT,
              manual_command: "claude",
            },
          );
        }

        if (preflight.files === 0) {
          throw Object.assign(
            new Error(
              "선택한 폴더에 진단할 마크다운 노트가 없어요.",
            ),
            { code: ERR.E_INVALID_INPUT },
          );
        }

        json(
          response,
          200,
          (options.startCheckup ?? startCheckup)(
            home,
            input.path,
            {
              userHome,
              excludedDirs: input.excluded_dirs,
            },
          ),
        );
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/checkup/import"
      ) {
        if (!fs.existsSync(path.join(home, "index.sqlite"))) {
          initStore(home);
        }
        json(response, 200, importCheckup(home, readConfig(home)));
        return;
      }

      if (
        request.method === "POST"
        && url.pathname === "/api/checkup/dismiss"
      ) {
        json(response, 200, dismissCheckup(home));
        return;
      }

      const setupMatch = request.method === "POST"
        && /^\/api\/setup\/(.+)$/u.exec(url.pathname);
      if (setupMatch) {
        const step = setupMatch[1];
        let result;

        if (step === "init") {
          result = initStore(home);
        } else if (step === "mcp") {
          if (!fs.existsSync(path.join(home, "index.sqlite"))) {
            initStore(home);
          }
          result = registerMcp(home, runner);
          claudeCache = null;
        } else if (step === "codex") {
          if (!fs.existsSync(path.join(home, "index.sqlite"))) {
            initStore(home);
          }
          result = registerMcpCodex(home, runner);
          codexCache = null;
        } else if (step === "instructions") {
          result = installInstructions(home, { userHome });
        } else if (step === "instructions-remove") {
          result = removeInstructions(home, { userHome });
        } else if (step === "daemon") {
          result = installDaemon(home, runner, { userHome });
        } else if (step === "daemon-remove") {
          result = uninstallDaemon(home, runner, { userHome });
        } else if (step === "digest") {
          const claude = checkClaudeLogin(runner);

          if (!claude.cli_exists) {
            json(response, 400, {
              error: ERR.E_CLAUDE_CLI_MISSING,
              message:
                "소화에는 Claude CLI가 필요해요. 먼저 'Claude Code 연결' 단계를 완료해 주세요.",
              manual_command:
                "npm install -g @anthropic-ai/claude-code && claude",
            });
            return;
          }

          if (!claude.logged_in) {
            json(response, 400, {
              error: "E_CLAUDE_LOGIN",
              message: "Claude CLI 로그인이 필요해요.",
            });
            return;
          }

          result = await (
            options.runDigest ?? runDigestInChild
          )(home);
        } else if (step === "sample") {
          result = seedSampleFacts(home);
        } else if (step === "sample-remove") {
          result = removeSampleFacts(home);
        } else {
          json(response, 404, {
            error: ERR.E_NOT_FOUND,
            message: "설치 단계를 찾을 수 없어요.",
          });
          return;
        }

        json(response, 200, result);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const supportedMethod = request.method === "GET"
          || request.method === "POST";
        json(
          response,
          supportedMethod ? 404 : 405,
          {
            error: supportedMethod
              ? ERR.E_NOT_FOUND
              : "E_METHOD_NOT_ALLOWED",
            message: supportedMethod
              ? "API를 찾을 수 없어요."
              : "허용되지 않은 요청 방식이에요.",
          },
        );
        return;
      }

      response.writeHead(404).end();
    } catch (error) {
      fail(response, 400, error);
    }
  };

  server = http.createServer(handler);
  return server;
}

export async function startDashboard(
  home,
  { port = 4600, open = true, ...options } = {},
) {
  const server = createDashboardServer(home, {
    ...options,
    port,
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address
    ? address.port
    : port;
  const url = `http://127.0.0.1:${actualPort}`;
  if (open) openBrowser(url);

  return {
    server,
    port: actualPort,
    url,
  };
}
