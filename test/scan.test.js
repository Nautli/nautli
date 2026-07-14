import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startDashboard } from "../src/dashboard/server.js";
import { ERR } from "../src/core/schema.js";
import {
  registerMcpCodex,
  statusAll,
} from "../src/onboard/setup.js";
import {
  scanUsage,
  writeScanCache,
} from "../src/onboard/scan.js";

function isolatedHome(t, prefix = "nautli-scan-") {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(userHome, ".nautli");
  t.after(() => {
    fs.rmSync(userHome, { recursive: true, force: true });
  });
  return { home, userHome };
}

function sessionFiles(userHome, agent, count, recentCount) {
  const root = agent === "claude"
    ? path.join(userHome, ".claude", "projects", "project-a")
    : path.join(userHome, ".codex", "sessions", "2026", "07");
  fs.mkdirSync(root, { recursive: true });

  const recent = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1_000,
  );
  const old = new Date(
    Date.now() - 45 * 24 * 60 * 60 * 1_000,
  );

  for (let index = 0; index < count; index += 1) {
    const file = path.join(
      root,
      `${agent}-${String(index).padStart(4, "0")}.jsonl`,
    );
    fs.writeFileSync(
      file,
      "contents must never be read\n",
      "utf8",
    );
    const timestamp = index < recentCount ? recent : old;
    fs.utimesSync(file, timestamp, timestamp);
  }
}

function agentRunner(calls = []) {
  return (command, args) => {
    calls.push([command, ...args]);
    if (command === "cursor" || command === "gemini") {
      throw new Error("missing");
    }
    if (args[0] === "mcp" && args[1] === "list") {
      return "nautli: connected\n";
    }
    return "ok\n";
  };
}

async function dashboard(
  t,
  { runner = agentRunner() } = {},
) {
  const userHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "nautli-scan-api-"),
  );
  const home = path.join(userHome, ".nautli");
  const started = await startDashboard(home, {
    port: 0,
    open: false,
    userHome,
    runner,
  });

  t.after(async () => {
    await new Promise((resolve) => {
      started.server.close(resolve);
    });
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  return {
    ...started,
    home,
    userHome,
    origin: `http://127.0.0.1:${started.port}`,
  };
}

test(
  "scanUsage counts only jsonl sessions modified within thirty days",
  async (t) => {
    const { userHome } = isolatedHome(t);
    sessionFiles(userHome, "claude", 12, 8);
    sessionFiles(userHome, "codex", 3, 2);

    const usage = await scanUsage({ userHome });
    assert.deepEqual(usage, {
      claude_sessions30d: 8,
      codex_sessions30d: 2,
      capped: false,
      partial: false,
    });
  },
);

test(
  "scanUsage never opens or reads a session file",
  async (t) => {
    const { userHome } = isolatedHome(
      t,
      "nautli-scan-no-open-",
    );
    sessionFiles(userHome, "claude", 12, 8);
    sessionFiles(userHome, "codex", 3, 2);

    const original = {
      readFileSync: fs.readFileSync,
      openSync: fs.openSync,
      createReadStream: fs.createReadStream,
    };
    const calls = {
      readFileSync: 0,
      openSync: 0,
      createReadStream: 0,
    };

    for (const name of Object.keys(original)) {
      fs[name] = (...args) => {
        calls[name] += 1;
        return original[name](...args);
      };
    }

    try {
      await scanUsage({ userHome });
    } finally {
      Object.assign(fs, original);
    }

    assert.deepEqual(calls, {
      readFileSync: 0,
      openSync: 0,
      createReadStream: 0,
    });
  },
);

test(
  "scanUsage stops after three thousand session files",
  async (t) => {
    const { userHome } = isolatedHome(
      t,
      "nautli-scan-cap-",
    );
    sessionFiles(userHome, "claude", 3_001, 3_001);

    const usage = await scanUsage({ userHome });
    assert.equal(usage.claude_sessions30d, 3_000);
    assert.equal(usage.codex_sessions30d, 0);
    assert.equal(usage.capped, true);
    assert.equal(usage.partial, false);
  },
);

test(
  "GET scan hides cached usage until the user opts in",
  async (t) => {
    const target = await dashboard(t);
    writeScanCache(target.home, {
      scanned_at: new Date().toISOString(),
      partial: false,
      capped: false,
      agents: [],
      usage: {
        claude_sessions30d: 99,
        codex_sessions30d: 88,
      },
      remembered: 0,
    });

    const before = await fetch(`${target.url}/api/scan`);
    assert.equal(before.status, 200);
    assert.equal((await before.json()).usage, null);

    sessionFiles(target.userHome, "claude", 12, 8);
    sessionFiles(target.userHome, "codex", 3, 2);

    const scanned = await fetch(`${target.url}/api/scan`, {
      method: "POST",
      headers: {
        origin: target.origin,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(scanned.status, 200);

    const result = await scanned.json();
    assert.equal(result.ok, true);
    assert.deepEqual(result.usage, {
      claude_sessions30d: 8,
      codex_sessions30d: 2,
    });

    const afterResponse = await fetch(
      `${target.url}/api/scan`,
    );
    const after = await afterResponse.json();
    assert.deepEqual(after.usage, result.usage);
  },
);

test(
  "Codex MCP registration succeeds over HTTP and keeps a manual fallback on failure",
  async (t) => {
    const calls = [];
    const target = await dashboard(t, {
      runner: agentRunner(calls),
    });

    const response = await fetch(
      `${target.url}/api/setup/codex`,
      {
        method: "POST",
        headers: {
          origin: target.origin,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.ok(
      calls.some(
        (call) => call[0] === "codex"
          && call[1] === "mcp"
          && call[2] === "add"
          && call[3] === "nautli"
          && call[4] === "--",
      ),
    );
    assert.equal(
      fs.existsSync(path.join(target.home, "index.sqlite")),
      true,
    );

    const failedRunner = (command, args) => {
      if (
        command === "codex"
        && args[0] === "mcp"
        && args[1] === "add"
      ) {
        throw new Error("failed");
      }
      return "ok\n";
    };

    assert.throws(
      () => registerMcpCodex(target.home, failedRunner),
      (error) => error.code === ERR.E_MCP_REGISTER_FAILED
        && /^codex mcp add nautli -- /u.test(
          error.manual_command,
        ),
    );

    assert.throws(
      () => registerMcpCodex(target.home, () => {
        throw new Error("missing");
      }),
      (error) => error.code === ERR.E_CODEX_CLI_MISSING
        && /^codex mcp add nautli -- /u.test(
          error.manual_command,
        ),
    );
  },
);

test(
  "statusAll treats Codex-only MCP as complete and preserves Claude compatibility fields",
  (t) => {
    const { home, userHome } = isolatedHome(
      t,
      "nautli-scan-codex-status-",
    );
    const runner = (command, args) => {
      if (command === "claude") {
        throw new Error("missing");
      }
      if (
        command === "codex"
        && args[0] === "mcp"
        && args[1] === "list"
      ) {
        return "nautli: connected\n";
      }
      return "ok\n";
    };

    const status = statusAll(home, {
      runner,
      userHome,
    });
    assert.equal(status.required.mcp.complete, true);
    assert.deepEqual(status.required.mcp.claude, {
      cli_exists: false,
      registered: false,
    });
    assert.deepEqual(status.required.mcp.codex, {
      cli_exists: true,
      registered: true,
    });
    assert.equal(status.required.mcp.cli_exists, false);
    assert.equal(status.required.mcp.registered, false);
  },
);

test("star nag timestamp is recorded only once", async (t) => {
  const target = await dashboard(t);
  const request = () => fetch(
    `${target.url}/api/star-nag-seen`,
    {
      method: "POST",
      headers: {
        origin: target.origin,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );

  const first = await request();
  assert.equal(first.status, 200);
  const firstResult = await first.json();
  assert.equal(firstResult.recorded, true);

  const second = await request();
  assert.equal(second.status, 200);
  const secondResult = await second.json();
  assert.equal(secondResult.recorded, false);
  assert.equal(
    secondResult.star_nag_shown_at,
    firstResult.star_nag_shown_at,
  );

  const config = JSON.parse(
    fs.readFileSync(
      path.join(target.home, "config.json"),
      "utf8",
    ),
  );
  assert.equal(
    config.star_nag_shown_at,
    firstResult.star_nag_shown_at,
  );
});
