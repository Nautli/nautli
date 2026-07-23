import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { remember } from "../src/core/gate.js";
import { STATUS } from "../src/core/schema.js";
import { Store, readEventLog } from "../src/core/store.js";
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

// TASK-075: /api/receipt/multi 라우트가 4개 윈도우 + 숫자별 근거 묶음을 돌려준다.
test("dashboard receipt multi route returns windows with drill-down evidence groups", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const fact = remember(store, {
    claim: "영수증 라우트 근거로 쓸 활성 기억",
    scope: "person",
    t_valid: "2026-07-01",
  });
  store.appendRecall({
    hits: [fact.id],
    session_id: "receipt-route-session",
    returned_chars: 40,
    at: new Date().toISOString(),
  });
  store.close();
  fs.writeFileSync(path.join(target.home, "review", "queue.jsonl"), `${JSON.stringify({
    pair_id: "receipt-route-pair",
    status: "answered",
    answered_by: "user",
    handled_at: new Date().toISOString(),
  })}\n`, "utf8");

  const response = await fetch(`${target.url}/api/receipt/multi`);
  assert.equal(response.status, 200);
  const multi = await response.json();

  assert.deepEqual(Object.keys(multi.windows).sort(), ["2d", "30d", "7d", "lifetime"]);
  assert.equal(multi.windows.lifetime.is_lifetime, true);
  assert.equal(typeof multi.active_start_approximate, "boolean");
  const groups = multi.windows["2d"].evidence_groups;
  assert.deepEqual(Object.keys(groups).sort(), ["active", "organized", "recall"]);
  assert.equal(groups.recall[0].hits, 1);
  assert.equal(groups.organized[0].pair_id, "receipt-route-pair");
  assert.ok(groups.active.some((item) => typeof item.sample_claim === "string"));
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

  // clusters and insights arrays exist and contain expected data
  assert.ok(Array.isArray(graph.clusters), "clusters is array");
  assert.ok(graph.clusters.length > 0, "clusters not empty");
  const graphCluster = graph.clusters.find((c) => c.scope === "project:graph");
  assert.ok(graphCluster, "cluster for project:graph exists");
  assert.equal(graphCluster.facts, 2, "cluster fact count");
  assert.ok(Array.isArray(graph.insights), "insights is array");
  // contradiction between same-scope facts appears in insights
  assert.ok(graph.insights.some((i) => i.kind === "contradiction"), "contradiction insight present");
});

test("dashboard graph returns empty clusters and insights for empty store", async (t) => {
  const target = await dashboard(t);
  const response = await fetch(`${target.url}/api/graph`);
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.deepEqual(graph.clusters, []);
  assert.deepEqual(graph.insights, []);
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.links, []);
});

test("dashboard graph links related memories by shared claim tokens", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  const paymentA = remember(store, {
    claim: "결제 웹훅 서명 검증 로직을 고쳤다",
    scope: "project:graph",
    t_valid: "2025-01-01",
  }, config);
  const paymentB = remember(store, {
    claim: "결제 웹훅 서명 키를 새로 발급했다",
    scope: "project:graph",
    t_valid: "2025-02-01",
  }, config);
  const unrelated = remember(store, {
    claim: "휴가 일정은 8월 첫 주다",
    scope: "person",
    t_valid: "2025-02-01",
  }, config);
  store.close();

  const response = await fetch(`${target.url}/api/graph`);
  assert.equal(response.status, 200);
  const graph = await response.json();
  const pairKey = [paymentA.id, paymentB.id].sort().join(":");
  assert.ok(graph.links.some((link) => link.kind === "related"
    && [link.a, link.b].sort().join(":") === pairKey));
  assert.ok(!graph.links.some((link) => link.kind === "related"
    && (link.a === unrelated.id || link.b === unrelated.id)));
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

// TASK-BATCH-FIX (F-6): the continuity lookup must log a delivery for ONLY the fact in the response
// payload, not every candidate the internal recall surfaced — otherwise audit delivery over-counts.
test("dashboard continuity delivery logs only the fact returned in the response", async (t) => {
  const target = await dashboard(t);
  const store = new Store(target.home);
  // Two facts share query terms, so recall() would surface both — but the response is only fact A.
  const a = remember(store, {
    claim: "the staging deployment port is 3000 for service alpha",
    scope: "person",
    source: "mcp",
  }, config);
  const b = remember(store, {
    claim: "the staging deployment port is 3000 for service beta",
    scope: "person",
    source: "mcp",
  }, config);
  store.close();
  assert.notEqual(a.id, b.id);

  const response = await fetch(`${target.url}/api/continuity/recall`, {
    method: "POST",
    headers: { origin: target.origin, "content-type": "application/json" },
    body: JSON.stringify({ fact_id: a.id }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).fact.id, a.id);

  const deliveries = readEventLog(target.home).filter(
    (event) => event.type === "recall" && event.tool === "dashboard.continuity",
  );
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].hits, [a.id]);
  assert.equal(deliveries[0].hits.includes(b.id), false, "the other candidate fact is not logged as delivered");
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

// TASK-FIX-B45: TASK-071/009가 추가한 스텝 benefit·AI 연결 카드 문자열은 ko/en/ja 로케일 맵에
// 모두 있어야 한다 — 하나라도 빠지면 en/ja에서 한국어 원문이 새어 나간다.
test("new TASK-071/009 dashboard strings are mapped in both en and ja (no Korean leak)", async () => {
  const { HTML } = await import("../src/dashboard/public.js");
  const dictStart = HTML.indexOf("  var DASH_EN=");
  const dictEnd = HTML.indexOf("  function resolveDashLang", dictStart);
  assert.ok(dictStart >= 0 && dictEnd > dictStart);
  const source = [
    HTML.slice(dictStart, dictEnd),
    "result={en:DASH_EN,ja:DASH_JA};",
  ].join("\n");
  const context = { result: null };
  new vm.Script(source).runInNewContext(context);
  const { en, ja } = context.result;

  const newKeys = [
    "완료하면: ",
    "사용 중",
    "연결 필요",
    "이 AI에서도 같은 기억을 바로 이어서 써요.",
    "AI마다 다시 설명하지 않아도 돼요.",
  ];
  for (const key of newKeys) {
    assert.equal(typeof en[key], "string", `${key} missing from DASH_EN`);
    assert.notEqual(en[key], key, `${key} must not leak Korean into English`);
    assert.equal(typeof ja[key], "string", `${key} missing from DASH_JA`);
    assert.notEqual(ja[key], key, `${key} must not leak Korean into Japanese`);
  }
});

async function renderDoneCheckup(summary, lang = "ko", checkupState = "done") {
  const { HTML } = await import("../src/dashboard/public.js");
  const dictStart = HTML.indexOf("  var DASH_EN=");
  const dictEnd = HTML.indexOf("  function resolveDashLang", dictStart);
  const blockStart = HTML.indexOf("  function checkupBlock(){", dictEnd);
  const blockEnd = HTML.indexOf("  function checkupSlot()", blockStart);
  assert.ok(dictStart >= 0 && dictEnd > dictStart && blockStart >= 0 && blockEnd > blockStart);
  const source = [
    HTML.slice(dictStart, dictEnd),
    "var LANG=" + JSON.stringify(lang) + ";",
    "function T(s){if(LANG===\"ko\")return s;var v=DASH_EN[s];return v===undefined?s:v;}",
    "function esc(value){return String(value==null?\"\":value).replace(/[&<>\"']/g,function(ch){return {\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[ch];});}",
    "var state={checkup:" + JSON.stringify({
      state: checkupState,
      vault: "/taste-vault",
      files_sampled: 30,
      cards: [],
      summary,
    }) + "};",
    HTML.slice(blockStart, blockEnd),
    "result=checkupBlock();",
  ].join("\n");
  const context = { result: "" };
  new vm.Script(source).runInNewContext(context);
  return context.result;
}

test("done checkup always renders dup_bytes as a separate confirmed local fact", async () => {
  const base = {
    score: 62,
    notes: 30,
    atoms: 3,
    duplicates: 0,
    contradictions: 0,
    junk_rate: null,
    waste_rate: 0,
  };
  const confirmed = await renderDoneCheckup({ ...base, dup_bytes: 512 });
  const zero = await renderDoneCheckup({ ...base, dup_bytes: 0 });
  const unmeasured = await renderDoneCheckup({ ...base, dup_bytes: null });

  for (const rendered of [confirmed, zero, unmeasured]) {
    assert.match(rendered, /class="checkup-waste neutral"/u);
    assert.match(rendered, /이번 AI 맛보기에서는 낭비 신호를 찾지 못했어요/u);
  }
  assert.match(confirmed, /확인된 중복 텍스트 최소 1KB\./u);
  assert.doesNotMatch(zero, /확인된 중복 텍스트 최소/u);
  assert.doesNotMatch(unmeasured, /확인된 중복 텍스트 최소/u);
});

test("done checkup preserves positive, zero, and null waste signal meanings", async () => {
  const base = {
    score: 62,
    notes: 30,
    atoms: 3,
    duplicates: 0,
    contradictions: 0,
    junk_rate: null,
    dup_bytes: 0,
  };
  const positive = await renderDoneCheckup({ ...base, waste_rate: 0.126 });
  const zero = await renderDoneCheckup({ ...base, waste_rate: 0 });
  const unmeasured = await renderDoneCheckup({ ...base, waste_rate: null });

  assert.match(positive, /class="checkup-waste warn"/u);
  assert.match(positive, /중복·낡은 조각 신호 약 13%/u);
  assert.match(positive, /전체 볼트의 낭비율이나 예상 절감률이 아닙니다/u);
  assert.match(zero, /class="checkup-waste neutral"/u);
  assert.match(zero, /미발견은 전체 볼트가 깨끗하다는 뜻이 아닙니다/u);
  assert.match(unmeasured, /class="checkup-waste neutral"/u);
  assert.match(unmeasured, /낭비 신호를 측정하지 못했어요/u);
  assert.match(unmeasured, /전체 볼트 상태는 판단할 수 없습니다/u);
});

// TASK-FIX-B45: 이미 가져온 상태로 재진입하면 활성 CTA가 아니라 "가져오기 완료" 비활성 상태여야 한다.
test("re-entered imported checkup shows a disabled done state, not the import CTA", async () => {
  const summary = {
    score: 62,
    notes: 30,
    atoms: 3,
    duplicates: 1,
    contradictions: 0,
    junk_rate: null,
    dup_bytes: 1024,
    waste_rate: 0.2,
  };
  const importedCard = await renderDoneCheckup(summary, "ko", "imported");
  // Waste signal is still shown on re-entry.
  assert.match(importedCard, /class="checkup-waste warn"/u);
  // The CTA is now a disabled "가져오기 완료" state — clicking again would no-op server-side.
  assert.match(importedCard, /data-checkup-import disabled>가져오기 완료</u);
  assert.doesNotMatch(importedCard, /건 가져오고 연결 계속/u, "no active import CTA after import");
  assert.doesNotMatch(importedCard, /가져오면 위 중복·모순/u, "no pre-import hint after import");

  // A done-but-not-imported card still offers the enabled import CTA.
  const doneCard = await renderDoneCheckup(summary, "ko", "done");
  assert.match(doneCard, /data-checkup-import >이 기억 3건 가져오고 연결 계속</u);
  assert.doesNotMatch(doneCard, /가져오기 완료/u);
});

test("checkup taste-signal copy is mapped in English without savings or health framing", async () => {
  const summary = {
    score: 62,
    notes: 30,
    atoms: 3,
    duplicates: 0,
    contradictions: 0,
    junk_rate: null,
    dup_bytes: 2048,
    waste_rate: 0.2,
  };
  const ko = await renderDoneCheckup(summary, "ko");
  const en = await renderDoneCheckup(summary, "en");

  assert.match(ko, /AI 맛보기 신호 62\/100 · 선택 표본 30개/u);
  assert.match(ko, /이번 맛보기에서 바로 확인할 중복·모순을 찾지 못했어요/u);
  assert.match(en, /AI taste signal 62\/100 · selected sample 30/u);
  assert.match(en, /Confirmed duplicate text: at least 2KB\./u);
  assert.match(en, /This AI taste test found about 20% duplicate or stale-fragment signals/u);
  for (const rendered of [ko, en]) {
    assert.doesNotMatch(rendered, /전체 클린|whole vault waste|health score|건강 점수|[0-9]+% 아껴요/iu);
  }

  const { HTML } = await import("../src/dashboard/public.js");
  assert.match(HTML, /ctx\.fillText\("taste signal "\+data\.score\+"\/100"/u);
  assert.match(HTML, /c\.state==="done"\|\|c\.state==="imported"/u);
  assert.match(HTML, /data-checkup-import/u);
  assert.match(HTML, /"이번 AI 맛보기의 낭비 신호를 측정하지 못했어요\. 전체 볼트 상태는 판단할 수 없습니다\.":"This AI taste test could not measure waste signals\. The state of the whole vault cannot be determined\."/u);
});
