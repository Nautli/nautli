import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { remember } from "../src/core/gate.js";
import { STATUS } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";
import { initStore } from "../src/onboard/setup.js";
import { startDashboard } from "../src/dashboard/server.js";

const config = { default_scope: "person" };

async function dashboard(t, options = {}) {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-dashboard-"));
  const home = path.join(userHome, ".nautli");
  const runner = options.runner ?? ((command, args) => {
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") return "nautli: connected\n";
    return "ok\n";
  });
  const started = await startDashboard(home, {
    ...options,
    port: 0,
    open: false,
    userHome,
    runner,
    runDigest: options.runDigest ?? (() => ({ ok: true, started: true })),
  });
  t.after(async () => {
    await new Promise((resolve) => started.server.close(resolve));
    fs.rmSync(userHome, { recursive: true, force: true });
  });
  return { ...started, home, origin: `http://127.0.0.1:${started.port}` };
}

test("dashboard serves the official brand favicons", async (t) => {
  const target = await dashboard(t);

  const svgResponse = await fetch(`${target.url}/favicon.svg`);
  assert.equal(svgResponse.status, 200);
  assert.equal(svgResponse.headers.get("content-type"), "image/svg+xml");
  const svg = await svgResponse.text();
  // 브랜드 킷 v2(2026-07-19): 액센트 Neon Green + 다크 라운드 그라운드.
  assert.match(svg, /#00E6A1/);
  assert.match(svg, /fill="#141414"/);

  const icoResponse = await fetch(`${target.url}/favicon.ico`);
  assert.equal(icoResponse.status, 200);
  assert.equal(icoResponse.headers.get("content-type"), "image/x-icon");
});

test("dashboard serves the appbar and command palette without native drag regions", async (t) => {
  const target = await dashboard(t);
  const response = await fetch(target.url);
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /id="appbar"/);
  assert.match(page, /id="cmdk"/);
  assert.match(page, /id="cmdk-input"/);
  assert.doesNotMatch(page, /-webkit-app-region/);
});

test("dashboard status combines setup, doctor, stats, and pending count", async (t) => {
  const target = await dashboard(t);
  initStore(target.home);
  const response = await fetch(`${target.url}/api/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.setup.required.store.complete, true);
  assert.equal(status.doctor.index_exists, true);
  assert.equal(status.stats.total, 0);
  assert.equal(status.pending, 0);
});

test("dashboard graph includes scope, supersedes, and pending review links", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const oldFact = remember(store, {
    claim: "그래프에 표시할 옛 기억",
    scope: "project:graph",
    t_valid: "2025-01-01",
  }, config);
  const newFact = remember(store, {
    claim: "그래프에 표시할 새 기억",
    scope: "project:graph",
    t_valid: "2025-02-01",
  }, config);
  store.transition(oldFact.id, STATUS.SUPERSEDED, {
    superseded_by: newFact.id,
    t_invalid: "2025-02-01",
  }, "daemon");
  fs.writeFileSync(path.join(target.home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: `${oldFact.id}:${newFact.id}`,
    verdict: "contradiction",
    status: "pending",
  })}\n`, "utf8");
  store.close();

  const response = await fetch(`${target.url}/api/graph`);
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.ok(graph.nodes.some((node) => node.kind === "scope" && node.scope === "project:graph"));
  assert.ok(graph.nodes.some((node) => node.kind === "fact" && node.id === oldFact.id));
  assert.ok(graph.nodes.some((node) => node.kind === "fact" && node.id === newFact.id));
  assert.ok(graph.links.some((link) => link.kind === "scope"));
  assert.ok(graph.links.some((link) => link.kind === "supersedes"));
  assert.ok(graph.links.some((link) => link.kind === "contradiction"));
});

test("dashboard card POST delegates pair-id idempotency to review", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const oldFact = remember(store, {
    claim: "대시보드 검토용 옛 기억",
    scope: "project:dashboard",
    t_valid: "2025-01-01",
  }, config);
  const newFact = remember(store, {
    claim: "대시보드 검토용 새 기억",
    scope: "project:dashboard",
    t_valid: "2025-02-01",
  }, config);
  const pairId = `${oldFact.id}:${newFact.id}`;
  fs.writeFileSync(path.join(target.home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: pairId,
    verdict: "duplicate",
    confidence: 0.8,
    claims: { a: "대시보드 검토용 옛 기억", b: "대시보드 검토용 새 기억" },
    status: "pending",
  })}\n`, "utf8");
  store.close();

  const options = {
    method: "POST",
    headers: { origin: target.origin, "content-type": "application/json" },
    body: JSON.stringify({ action: "merge" }),
  };
  assert.equal((await (await fetch(`${target.url}/api/status`)).json()).pending, 1);
  const first = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, options);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).ok, true);
  const second = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: false, reason: "already_handled" });
  assert.equal((await (await fetch(`${target.url}/api/status`)).json()).pending, 0);
  const page = await (await fetch(target.url)).text();
  assert.match(page, /id="pending-badge"/);
  assert.match(page, /setChrome\(\)/);
});

test("dashboard rejects state changes from a non-allowlisted Origin", async (t) => {
  const target = await dashboard(t);
  const response = await fetch(`${target.url}/api/setup/init`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:9999", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "E_ORIGIN_FORBIDDEN");
  assert.equal(fs.existsSync(path.join(target.home, "index.sqlite")), false);
});

test("digest preflight returns E_CLAUDE_LOGIN without starting daemon-run", async (t) => {
  let digestRuns = 0;
  const target = await dashboard(t, {
    runner: (command, args) => ({
      status: command === "claude" && args[0] === "auth" ? 1 : 0,
      stdout: "",
      stderr: "",
    }),
    runDigest: () => {
      digestRuns += 1;
      return { ok: true, started: true };
    },
  });

  const response = await fetch(`${target.url}/api/setup/digest`, {
    method: "POST",
    headers: {
      origin: target.origin,
      "content-type": "application/json",
      "accept-language": "ko",
    },
    body: "{}",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "E_CLAUDE_LOGIN",
    message: "Claude CLI 로그인이 필요해요.",
  });
  assert.equal(digestRuns, 0);
});

test("dashboard translates remember gate rejection into human-readable 400 JSON", async (t) => {
  const target = await dashboard(t);
  const response = await fetch(`${target.url}/api/memory`, {
    method: "POST",
    headers: {
      origin: target.origin,
      "content-type": "application/json",
      "accept-language": "ko",
    },
    body: JSON.stringify({ claim: "첫째; 둘째; 셋째", scope: "person" }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "E_MULTI_FACT",
    message: "한 번에 한 가지 기억만 추가해 주세요.",
  });
});

test("dashboard restores an elapsed deferred card on the next cards request", async (t) => {
  const target = await dashboard(t);
  initStore(target.home);
  const queue = path.join(target.home, "review", "queue.jsonl");
  fs.writeFileSync(queue, `${JSON.stringify({
    pair_id: "fa_deferreda:fa_deferredb",
    verdict: "duplicate",
    status: "deferred",
    deferred_until: "2000-01-01",
  })}\n`, "utf8");
  const response = await fetch(`${target.url}/api/cards`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cards.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(queue, "utf8").trim()).status, "pending");
});

test("dashboard returns a human rejection and preserves an other card", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const a = remember(store, { claim: "기타 정정 중복 원문", scope: "project:dashboard-other" }, config);
  const b = remember(store, { claim: "기타 정정 비교 문장", scope: "project:dashboard-other" }, config);
  const pairId = `${a.id}:${b.id}`;
  fs.writeFileSync(path.join(target.home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: pairId,
    verdict: "contradiction",
    status: "pending",
  })}\n`, "utf8");
  store.close();
  const response = await fetch(`${target.url}/api/cards/${encodeURIComponent(pairId)}`, {
    method: "POST",
    headers: {
      origin: target.origin,
      "content-type": "application/json",
      "accept-language": "ko",
    },
    body: JSON.stringify({ action: "other", extraText: "기타 정정 중복 원문" }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "W_DUPLICATE",
    message: "이미 같은 기억이 저장되어 있어요.",
  });
  assert.equal((await (await fetch(`${target.url}/api/status`)).json()).pending, 1);
});

test("instructions preview separates location from the pure copy block and exposes fallback UX", async (t) => {
  const target = await dashboard(t);
  const preview = await (await fetch(`${target.url}/api/instructions/preview`, {
    headers: { "accept-language": "ko" },
  })).json();
  assert.match(preview.preview, /추가될 위치:/);
  assert.match(preview.preview, /추가될 블록:/);
  assert.match(preview.block, /^<!-- nautli:instructions -->/);
  assert.doesNotMatch(preview.block, /추가될 위치:/);
  const page = await (await fetch(target.url)).text();
  assert.match(page, /id="manual-copy"/);
  assert.match(page, /클립보드 복사에 실패했어요/);
  assert.match(page, /attempt<120/);
  assert.match(page, /소화 중… 최대 2분/);
  assert.match(page, /finally\{if\(button\.isConnected\)/);
});

test("dashboard continuity recall returns the detected fact and records a dashboard recall", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const added = remember(store, {
    claim: "나는 커밋 메시지를 한국어로 쓴다",
    scope: "person",
    source: "mcp",
  }, config);
  store.close();

  const since = new Date(Date.now() - 60_000).toISOString();
  const response = await fetch(`${target.url}/api/continuity/recall`, {
    method: "POST",
    headers: { origin: target.origin, "content-type": "application/json" },
    body: JSON.stringify({ fact_id: added.id }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    fact: { id: added.id, claim: "나는 커밋 메시지를 한국어로 쓴다", scope: "person" },
  });
  const activity = await (await fetch(`${target.url}/api/activity?since=${encodeURIComponent(since)}`)).json();
  assert.ok(activity.events.some((event) => event.type === "remember" && event.source === "mcp"));
  assert.ok(activity.events.some((event) => event.type === "recall"
    && event.source === "dashboard" && event.hits.includes(added.id)));
});

test("dashboard share-card contract contains only aggregate render fields", async (t) => {
  const target = await dashboard(t);
  const runDir = path.join(target.home, "checkup", "doctor", "runs", "share-test");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({
    score: 62,
    notes: 30,
    atoms: 8,
    duplicates: 4,
    contradictions: 2,
    junk_rate: 0.125,
  }));
  fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify({ files: 30, batches: [] }));
  fs.writeFileSync(path.join(target.home, "checkup", "current.json"), JSON.stringify({
    state: "running",
    vault: path.join(target.home, "private-project"),
    run_dir: runDir,
    started_at: new Date(Date.now() - 7.5 * 60_000).toISOString(),
    pid: null,
  }));

  const response = await fetch(`${target.url}/api/checkup/share-card`);
  assert.equal(response.status, 200);
  const card = await response.json();
  assert.deepEqual(Object.keys(card).sort(), [
    "contradictions", "cta", "duplicates", "junk_percent", "minutes", "sampled_notes", "score",
  ]);
  assert.deepEqual(card, {
    contradictions: 2,
    duplicates: 4,
    junk_percent: 13,
    sampled_notes: 30,
    minutes: 8,
    score: 62,
    cta: "What's hiding in yours? npx nautli dashboard",
  });
  assert.doesNotMatch(JSON.stringify(card), /claim|path|project|vault|private-project/i);
});

test("dashboard page exposes continuity, hardened checkup, and local share-card UX", async (t) => {
  const target = await dashboard(t);
  const page = await (await fetch(target.url)).text();
  assert.match(page, /첫 진짜 기억/);
  assert.match(page, /붙여넣으셨나요\?/);
  assert.match(page, /Claude가 응답하면 자동으로 감지됩니다/);
  assert.match(page, /방금 두 도구가 같은 뇌를 썼습니다/);
  assert.match(page, /선택한 폴더의 노트 텍스트가 내 Claude 구독을 거쳐 Anthropic에서 처리됩니다\. 요약·점수만 로컬에 저장되고 어디에도 업로드되지 않습니다\./);
  assert.match(page, /data-checkup-dir/);
  assert.match(page, /지금까지: 모순/);
  assert.match(page, /data-share-download/);
  assert.match(page, /toBlob/);
});

test("dashboard scan contract keeps usage null until explicit opt in", async (t) => {
  const agents = [
    { name: "claude", installed: true, connected: true },
    { name: "codex", installed: true, connected: false },
    { name: "cursor", installed: false, connected: null },
    { name: "gemini", installed: false, connected: null },
  ];
  const target = await dashboard(t, {
    detectAgents: async () => agents,
    scanUsage: async () => ({
      claude_sessions30d: 12,
      codex_sessions30d: 3,
      capped: false,
      partial: false,
    }),
  });

  const before = await (await fetch(`${target.url}/api/scan`)).json();
  assert.equal(before.ok, true);
  assert.deepEqual(before.agents, agents);
  assert.equal(before.usage, null);

  const scannedResponse = await fetch(`${target.url}/api/scan`, {
    method: "POST",
    headers: {
      origin: target.origin,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(scannedResponse.status, 200);
  const scanned = await scannedResponse.json();
  assert.equal(scanned.ok, true);
  assert.deepEqual(scanned.usage, {
    claude_sessions30d: 12,
    codex_sessions30d: 3,
  });

  const after = await (await fetch(`${target.url}/api/scan`)).json();
  assert.deepEqual(after.usage, scanned.usage);
});

test("dashboard checklist is derived from existing feature states", async (t) => {
  const target = await dashboard(t);
  const page = await (await fetch(target.url)).text();

  assert.match(page, /function checklistState\(\)/);
  assert.match(page, /state\.continuity\.a===\"done\"/);
  assert.match(page, /checkup\.state===\"done\"/);
  assert.match(page, /claude\.connected&&codex\.connected/);
  assert.match(page, /state\.status\.setup\.optional\.cursor/);
  assert.match(page, /title:T\("공유 카드 만들기"\)/);
  assert.match(page, /다음 할 일/);
  assert.match(page, /다 됐어요\. 이제 nautli는 알아서 굴러가요/);
  assert.doesNotMatch(page, /title:\"GitHub/);
});

test("dashboard star nag is recorded once and wired to a successful checkup import", async (t) => {
  const target = await dashboard(t);
  const markSeen = () => fetch(`${target.url}/api/star-nag-seen`, {
    method: "POST",
    headers: {
      origin: target.origin,
      "content-type": "application/json",
    },
    body: "{}",
  });

  const first = await (await markSeen()).json();
  const second = await (await markSeen()).json();
  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(second.star_nag_shown_at, first.star_nag_shown_at);

  const page = await (await fetch(target.url)).text();
  assert.match(page, /기억 정리를 시작했어요\. nautli가 쓸만하면 별 하나 주세요/);
  assert.match(page, /Your memories are getting organized\. If nautli earns it, leave us a star/);
  assert.match(page, /post\(\"\/api\/star-nag-seen\"\)/);
  assert.match(page, /var checkupImport=.*await loadCheckup\(\);await loadStatus\(\);setTimeout\(function\(\)\{void maybeShowStarNag\(\);\},4000\);/);
  assert.doesNotMatch(page, /var action=.*maybeShowStarNag/);
  assert.match(page, /https:\/\/github\.com\/Nautli\/nautli/);
  assert.match(page, /data-star-later/);
});

test("dashboard onboarding copy keeps the inline hero and privacy contract", async (t) => {
  const target = await dashboard(t);
  const page = await (await fetch(target.url)).text();

  assert.match(page, /감지된 AI /);
  assert.match(page, /내 AI 사용량 확인하기/);
  assert.match(page, /로컬에서만 · 파일 목록과 수정 시각만 · 네트워크 요청 0회/);
  assert.match(page, /최근 30일 Claude /);
  assert.match(page, /다음 대화부터는 여기 남아요\./);
  assert.match(page, /agent\.name===\"codex\"/);
  assert.match(page, /data-scan-usage/);
  assert.doesNotMatch(page, /[—–]/u);
});

test("dashboard served script parses after template-literal unescaping (i18n regression gate)", async () => {
  const { HTML } = await import("../src/dashboard/public.js");
  // Zero-touch: review tab replaced with cleanup history tab
  assert.match(HTML, /T\("정리 내역"\)/u);
  assert.match(HTML, /T\("되돌리기"\)/u);
  assert.match(HTML, /T\("중복 합침"\)/u);
  assert.match(HTML, /T\("자동 기억"\)/u);
  assert.match(HTML, /"정리 내역":"Cleanup history"/u);
  assert.match(HTML, /"되돌리기":"Undo"/u);
  assert.match(HTML, /data-undo=/u);
  const parts = HTML.split("<script>");
  assert.ok(parts.length >= 2, "expected inline scripts");
  for (let i = 1; i < parts.length; i += 1) {
    const script = parts[i].split("</script>")[0];
    new vm.Script(script); // throws on served-level SyntaxError
  }
  const dict = HTML.match(/var DASH_EN=\{/);
  assert.ok(dict, "DASH_EN dictionary embedded");
});
