import fs from "node:fs";
import path from "node:path";
import { readLogicalEvents } from "./store.js";

const DAY_MS = 86_400_000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ORGANIZED_STATUSES = new Set(["answered", "dismissed", "routed"]);

// TASK-075: receipt 부산물(월파일 요약 캐시·주간 스냅샷)은 이 폴더에 둔다.
const RECEIPT_DIR = "receipt";
const CACHE_FILE = "summary-cache.json";
const SNAPSHOT_FILE = "week-snapshot.json";
// 캐시/스냅샷 스키마 토큰 — 산출물 형태가 바뀌면 올려 옛 캐시를 무효화한다.
const CACHE_SCHEMA = 1;
const SNAPSHOT_SCHEMA = 1;

function installDate(home) {
  const evDir = path.join(home, "events");
  let earliest = Infinity;
  if (fs.existsSync(evDir)) {
    const files = fs.readdirSync(evDir)
      .filter((n) => /^\d{4}-\d{2}\.jsonl$/u.test(n))
      .sort();
    if (files.length > 0) {
      const first = readJsonLines(path.join(evDir, files[0]));
      for (const entry of first) {
        const t = Date.parse(entry.at);
        if (Number.isFinite(t) && t < earliest) { earliest = t; break; }
      }
    }
  }
  const dbFile = path.join(home, "index.sqlite");
  if (fs.existsSync(dbFile)) {
    try {
      const birth = fs.statSync(dbFile).birthtimeMs;
      if (Number.isFinite(birth) && birth < earliest) earliest = birth;
    } catch { /* stat failure is non-fatal */ }
  }
  return Number.isFinite(earliest) ? earliest : null;
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  const values = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) values.push(value);
    } catch {
      // A partial or damaged line does not erase the other measured records.
    }
  }
  return values;
}

// TASK-075: 이벤트 정본과 리뷰 큐를 디스크에서 한 번만 읽어 컨텍스트로 만든다. buildReceiptMulti는
// 이 컨텍스트를 4개 윈도우가 공유하므로 4회 풀 스캔이 1회로 줄어든다(단일 이벤트 패스).
// TASK-BATCH-FIX (F-7): ev_id 첫-등장-우선 논리 리더를 그대로 소비해 감사와 중복 계산이 갈리지 않게 한다.
function readReceiptContext(home) {
  const events = fs.existsSync(path.join(home, "events"))
    ? readLogicalEvents(home).filter((value) => value && typeof value === "object" && !Array.isArray(value))
    : [];
  const queue = readJsonLines(path.join(home, "review", "queue.jsonl"));
  return { events, queue };
}

function inWindow(value, cutoff, now) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= cutoff && time <= now;
}

function sessionId(event) {
  for (const field of ["session_id", "conversation_id", "session"]) {
    // TASK-104: "unknown"은 세션 미상 센티널 — 실제 식별자가 아니므로 버킷 폴백(approx)로 센다.
    if (typeof event[field] === "string"
      && event[field].trim() !== ""
      && event[field].trim() !== "unknown") {
      return event[field].trim();
    }
  }
  return null;
}

function organizedActor(entry) {
  if (entry.answered_by === "oracle") return "oracle";
  if (entry.answered_by === "triage" || entry.status === "routed") return "triage";
  return "user";
}

function activeCount(store) {
  if (!store) return 0;
  try {
    const stats = store.stats();
    return Number(stats?.byStatus?.active ?? 0);
  } catch {
    return 0;
  }
}

function corpusChars(store) {
  try {
    const row = store?.db?.prepare?.(
      "SELECT COALESCE(SUM(LENGTH(claim)),0) AS chars FROM facts WHERE status = 'active'",
    )?.get?.();
    return Number(row?.chars ?? 0);
  } catch {
    return 0;
  }
}

// TASK-075: 활성 기억 표본 — "이어지는 사실" 숫자를 실물로 뒷받침하는 최근 active fact 3건.
function activeExamples(store) {
  try {
    const rows = store?.db?.prepare?.(
      "SELECT claim, scope, t_created FROM facts WHERE status = 'active' "
      + "ORDER BY t_created DESC, rowid DESC LIMIT 3",
    )?.all?.() ?? [];
    return rows.map((row) => ({
      at: typeof row.t_created === "string" ? row.t_created : null,
      scope: typeof row.scope === "string" && row.scope !== "" ? row.scope : null,
      sample_claim: typeof row.claim === "string"
        ? (row.claim.length > 80 ? `${row.claim.slice(0, 80)}…` : row.claim)
        : null,
    }));
  } catch {
    return [];
  }
}

function correctedExamples(events, store, cutoff, now) {
  if (!store || typeof store.getFact !== "function") return [];
  try {
    const examples = [];
    const superseded = events
      .filter((event) => event.ev === "fact.superseded" && inWindow(event.at, cutoff, now))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    for (const event of superseded) {
      const oldFact = store.getFact(event.id);
      const newFact = store.getFact(event.patch?.superseded_by);
      if (typeof oldFact?.claim !== "string" || typeof newFact?.claim !== "string") continue;
      examples.push({
        at: event.at,
        old_claim: oldFact.claim.length > 80 ? `${oldFact.claim.slice(0, 80)}…` : oldFact.claim,
        new_claim: newFact.claim.length > 80 ? `${newFact.claim.slice(0, 80)}…` : newFact.claim,
      });
      if (examples.length === 2) break;
    }
    return examples;
  } catch {
    return [];
  }
}

// TASK-075: now 시각이 속한 로컬 주의 시작(월요일 00:00 로컬)을 ms로 돌려준다.
export function localWeekStart(nowTime) {
  const d = new Date(nowTime);
  if (!Number.isFinite(d.getTime())) return null;
  const sinceMonday = (d.getDay() + 6) % 7; // 0=일 … → 월요일까지 거슬러 갈 일수
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - sinceMonday);
  return d.getTime();
}

// TASK-FIX-B45: 캐시가 유효한 "하루"는 UTC floor(now/DAY)가 아니라 로컬 달력 하루다.
// nowTime을 로컬 날짜(YYYY-MM-DD)로 접는다 — 로컬 자정을 넘기면 값이 달라진다.
function localDayKey(nowTime) {
  const d = new Date(nowTime);
  if (!Number.isFinite(d.getTime())) return "invalid";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function snapshotPath(home) {
  return path.join(home, RECEIPT_DIR, SNAPSHOT_FILE);
}

function readWeekSnapshot(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(snapshotPath(home), "utf8"));
    if (!raw || typeof raw !== "object" || raw.schema !== SNAPSHOT_SCHEMA) return null;
    return raw;
  } catch {
    return null;
  }
}

// temp+rename 원자 쓰기 — 반쯤 쓰다 만 캐시/스냅샷이 다음 조회에서 읽히지 않게 한다.
function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  fs.renameSync(tmp, file);
}

// TASK-075: 로컬 주 시작 시점의 활성 기억 수를 스냅샷으로 고정한다. 스냅샷이 있으면 active-start를
// 정확히 알 수 있어 approximate=false. 없으면 이번 주 베이스라인을 지금 값으로 새로 심고, 이번 조회는
// (읽는 순간 스냅샷이 없었으므로) approximate=true 로 델타 폴백을 쓴다.
function resolveWeekSnapshot(home, store, nowTime) {
  const weekStart = localWeekStart(nowTime);
  if (weekStart == null) return { value: null, approximate: true };
  const weekStartIso = new Date(weekStart).toISOString();
  const snap = readWeekSnapshot(home);
  const haveThisWeek = snap
    && snap.week_start === weekStartIso
    && Number.isFinite(Number(snap.facts_active_at_start));
  if (haveThisWeek) {
    // TASK-FIX-B45: 주 시작 이후에 잡힌 베이스라인은 그 자체로 근사다(수요일 첫 조회가 수요일
    // 값을 월요일 시작값으로 저장하는 버그). captured_at이 주 시작 이후면 approximate 유지 —
    // 주 시작-이하에 잡힌 스냅샷(다음 월요일 첫 조회/패트롤이 심음)이 생겨야 정확값이 된다.
    // captured_at이 없는 레거시 스냅샷은 후방호환으로 정확값 취급한다.
    const capturedTime = Date.parse(snap.captured_at);
    const capturedAfterStart = Number.isFinite(capturedTime) && capturedTime > weekStart;
    if (!capturedAfterStart) {
      return {
        value: { facts_active_at_start: Number(snap.facts_active_at_start) },
        approximate: false,
      };
    }
    // 이번 주 스냅샷이 이미 심겼지만 주 시작 이후 값이다 — 재기록하지 않고 델타 폴백을 쓴다.
    return { value: null, approximate: true };
  }
  try {
    writeJsonAtomic(snapshotPath(home), {
      schema: SNAPSHOT_SCHEMA,
      week_start: weekStartIso,
      facts_active_at_start: activeCount(store),
      captured_at: new Date(nowTime).toISOString(),
    });
  } catch {
    // 스냅샷 기록 실패는 비치명적 — 이번 조회는 델타 폴백으로 진행한다.
  }
  return { value: null, approximate: true };
}

function monthlyEventFiles(home) {
  const dir = path.join(home, "events");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}\.jsonl$/u.test(name))
    .sort();
}

function cachePath(home) {
  return path.join(home, RECEIPT_DIR, CACHE_FILE);
}

// 캐시 키 = 스키마 + 로컬-하루 + (월 이벤트 파일들 + 리뷰 큐 + 주간 스냅샷) 각각의 filename:size:mtime.
// 어떤 정본 파일이든 크기/수정시각이 바뀌면 키가 달라져 캐시가 자동 무효화된다.
// TASK-FIX-B45: 로컬 달력 하루를 키 성분으로 직접 포함 — 로컬 자정을 넘기면 2d/7d 윈도우와
// since_at 경계가 어긋나므로 캐시 미스가 나야 한다(옛 now_day side-guard는 UTC 기준이라 stale).
function cacheSignature(home, nowTime) {
  const parts = [`schema=${CACHE_SCHEMA}`, `day=${localDayKey(nowTime)}`];
  const evDir = path.join(home, "events");
  for (const name of monthlyEventFiles(home)) {
    const st = fs.statSync(path.join(evDir, name));
    parts.push(`${name}:${st.size}:${Math.round(st.mtimeMs)}`);
  }
  for (const rel of [["review", "queue.jsonl"], [RECEIPT_DIR, SNAPSHOT_FILE]]) {
    const file = path.join(home, ...rel);
    if (fs.existsSync(file)) {
      const st = fs.statSync(file);
      parts.push(`${rel.join("/")}:${st.size}:${Math.round(st.mtimeMs)}`);
    }
  }
  return parts.join("|");
}

function readCache(home, nowTime) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
    if (!raw || raw.schema !== CACHE_SCHEMA) return null;
    // TASK-FIX-B45: 로컬-하루가 키에 포함되므로 별도 now_day side-guard 없이 키 비교만으로 충분하다.
    if (raw.key !== cacheSignature(home, nowTime)) return null;
    return raw.value ?? null;
  } catch {
    return null;
  }
}

function writeCache(home, nowTime, value) {
  try {
    writeJsonAtomic(cachePath(home), {
      schema: CACHE_SCHEMA,
      key: cacheSignature(home, nowTime),
      value,
    });
  } catch {
    // 캐시 기록 실패는 비치명적 — 결과는 그대로 반환한다.
  }
}

// TASK-075: 한 윈도우의 영수증을 이미 읽어둔 컨텍스트(ctx)에서 계산한다. buildReceipt와
// buildReceiptMulti가 이 함수 하나를 공유한다 — 계산 로직을 복붙하지 않는다.
function computeReceipt(home, store, ctx, { windowDays, nowTime, clock, installed, snapshot }) {
  const cutoff = nowTime - windowDays * DAY_MS;
  const { events, queue } = ctx;
  const conversations = new Set();
  const recallSamples = [];
  let approx = false;
  let tokensDelivered = 0;

  for (const event of events) {
    if (event.type !== "recall"
      || event.ev !== undefined
      || !Array.isArray(event.hits)
      || event.hits.length === 0
      || !inWindow(event.at, cutoff, nowTime)) continue;

    recallSamples.push(event);
    const id = sessionId(event);
    if (id) {
      conversations.add(`session:${id}`);
    } else {
      approx = true;
      const bucket = Math.floor(Date.parse(event.at) / TEN_MINUTES_MS);
      conversations.add(`bucket:${bucket}:${String(event.scope ?? "")}`);
    }

    if (Number.isFinite(event.returned_chars) && event.returned_chars >= 0) {
      tokensDelivered += Math.ceil(event.returned_chars / 4);
      continue;
    }
    const ids = [...new Set(event.hits.filter((factId) => typeof factId === "string"))];
    let claimChars = 0;
    for (const factId of ids) {
      const fact = store?.getFact?.(factId);
      if (typeof fact?.claim === "string") claimChars += fact.claim.length;
    }
    tokensDelivered += Math.ceil(claimChars / 4);
  }

  const handledByPair = new Map();
  for (const entry of queue) {
    if (typeof entry.pair_id !== "string"
      || entry.pair_id === ""
      || !ORGANIZED_STATUSES.has(entry.status)
      || !inWindow(entry.handled_at, cutoff, nowTime)) continue;
    const handledTime = Date.parse(entry.handled_at);
    const previous = handledByPair.get(entry.pair_id);
    if (!previous || handledTime > previous.handledTime) {
      handledByPair.set(entry.pair_id, { entry, handledTime });
    }
  }
  const organizedBy = { oracle: 0, triage: 0, user: 0 };
  for (const { entry } of handledByPair.values()) organizedBy[organizedActor(entry)] += 1;

  let factsDelta = 0;
  let selfCorrected = 0;
  for (const event of events) {
    if (!inWindow(event.at, cutoff, nowTime)) continue;
    if (event.ev === "fact.added"
      && (event.fact?.status === undefined || event.fact?.status === "active")) {
      factsDelta += 1;
    } else if (event.ev === "fact.invalidated" || event.ev === "fact.superseded") {
      factsDelta -= 1;
      selfCorrected += 1;
    }
  }

  // 큰 숫자를 실물로 뒷받침하는 표본: 윈도우 내 최근 recall 3건 + 사용된 기억 원문 일부.
  const recallEvidence = recallSamples
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 3)
    .map((event) => {
      const firstFactId = event.hits.find((factId) => typeof factId === "string");
      const fact = firstFactId ? store?.getFact?.(firstFactId) : null;
      const claim = typeof fact?.claim === "string" ? fact.claim : null;
      return {
        at: event.at,
        scope: typeof event.scope === "string" && event.scope !== "" ? event.scope : null,
        hits: event.hits.length,
        sample_claim: claim ? (claim.length > 80 ? `${claim.slice(0, 80)}…` : claim) : null,
      };
    });

  // TASK-075: "알아서 정리한 기록" 숫자를 뒷받침하는 최근 처리 3건.
  const organizedEvidence = [...handledByPair.values()]
    .sort((a, b) => b.handledTime - a.handledTime)
    .slice(0, 3)
    .map(({ entry }) => ({
      at: entry.handled_at,
      actor: organizedActor(entry),
      status: entry.status,
      pair_id: entry.pair_id,
    }));

  const memoryAgeDays = installed != null
    ? Math.max(1, Math.ceil((nowTime - installed) / DAY_MS))
    : null;

  const conversationCount = conversations.size;
  const organized = handledByPair.size;
  const factsActive = activeCount(store);
  const corpusTokens = Math.ceil(corpusChars(store) / 4);

  // TASK-075: active-start는 로컬 주 스냅샷이 있으면 정확값, 없으면 델타 재구성(근사)이다.
  let factsActiveAtStart;
  let activeStartApproximate;
  if (snapshot && Number.isFinite(Number(snapshot.facts_active_at_start))) {
    factsActiveAtStart = Number(snapshot.facts_active_at_start);
    activeStartApproximate = false;
  } else {
    factsActiveAtStart = Math.max(0, factsActive - factsDelta);
    activeStartApproximate = true;
  }

  const activity = conversationCount + organized + factsActive + Math.abs(factsDelta);
  return {
    days: windowDays,
    since_at: new Date(cutoff).toISOString(),
    generated_at: clock.toISOString(),
    conversations: conversationCount,
    approx,
    tokens_delivered: tokensDelivered,
    method: "chars_div4",
    organized,
    organized_by: organizedBy,
    facts_active: factsActive,
    corpus_tokens: corpusTokens,
    facts_active_at_start: factsActiveAtStart,
    facts_active_at_start_approximate: activeStartApproximate,
    facts_delta: factsDelta,
    self_corrected: selfCorrected,
    corrected_examples: correctedExamples(events, store, cutoff, nowTime),
    evidence: recallEvidence,
    evidence_groups: {
      recall: recallEvidence,
      organized: organizedEvidence,
      active: activeExamples(store),
    },
    memory_age_days: memoryAgeDays,
    installed_at: installed != null ? new Date(installed).toISOString() : null,
    sample_ok: conversationCount >= 3,
    activity,
  };
}

export function buildReceipt(home, store, { days = 7, now, installed: installedOpt } = {}) {
  const windowDays = Number.isFinite(Number(days)) && Number(days) > 0
    ? Number(days)
    : 7;
  const clock = now === undefined ? new Date() : new Date(now);
  if (!Number.isFinite(clock.getTime())) throw new TypeError("Invalid receipt clock");
  const nowTime = clock.getTime();
  const installed = installedOpt !== undefined ? installedOpt : installDate(home);
  const ctx = readReceiptContext(home);
  return computeReceipt(home, store, ctx, {
    windowDays, nowTime, clock, installed, snapshot: null,
  });
}

const RECEIPT_WINDOWS = { "2d": 2, "7d": 7, "30d": 30 };
// 캐시가 켜지는 최소 월 이벤트 파일 수 — 히스토리가 얕으면 스캔이 싸서 캐시하지 않는다.
const CACHE_MIN_MONTHLY_FILES = 3;

const CHAMBER_MILESTONES = [
  { days: 7, ko: "첫 번째 방", en: "First Chamber", ja: "最初の部屋" },
  { days: 30, ko: "두 번째 방", en: "Second Chamber", ja: "二番目の部屋" },
  { days: 100, ko: "세 번째 방", en: "Third Chamber", ja: "三番目の部屋" },
  { days: 365, ko: "네 번째 방", en: "Fourth Chamber", ja: "四番目の部屋" },
];

function milestoneFor(memoryAgeDays) {
  if (memoryAgeDays == null) return null;
  for (let i = CHAMBER_MILESTONES.length - 1; i >= 0; i--) {
    if (memoryAgeDays >= CHAMBER_MILESTONES[i].days) {
      const nextM = CHAMBER_MILESTONES[i + 1] || null;
      return { ...CHAMBER_MILESTONES[i], next: nextM };
    }
  }
  return null;
}

export function buildReceiptMulti(home, store, { now } = {}) {
  const clock = now === undefined ? new Date() : new Date(now);
  const nowTime = clock.getTime();
  const installed = installDate(home);
  const lifetimeDays = installed != null
    ? Math.max(1, Math.ceil((nowTime - installed) / DAY_MS))
    : 30;

  // 주간 스냅샷을 먼저 확정한다(필요 시 파일이 새로 쓰이며, 그 mtime이 캐시 키에 반영된다).
  const snapshot = resolveWeekSnapshot(home, store, nowTime);

  const useCache = monthlyEventFiles(home).length >= CACHE_MIN_MONTHLY_FILES;
  if (useCache) {
    const cached = readCache(home, nowTime);
    if (cached) return { ...cached, from_cache: true, generated_at: clock.toISOString() };
  }

  // 단일 이벤트 패스: 정본을 한 번만 읽어 4개 윈도우가 공유한다.
  const ctx = readReceiptContext(home);
  const thresholds = { ...RECEIPT_WINDOWS, lifetime: lifetimeDays };
  const windows = {};
  for (const [key, d] of Object.entries(thresholds)) {
    windows[key] = computeReceipt(home, store, ctx, {
      windowDays: d,
      nowTime,
      clock,
      installed,
      snapshot: key === "7d" ? snapshot.value : null,
    });
  }
  windows.lifetime.is_lifetime = true;

  const memoryAgeDays = installed != null ? lifetimeDays : null;
  const result = {
    windows,
    installed_at: installed != null ? new Date(installed).toISOString() : null,
    memory_age_days: memoryAgeDays,
    milestone: milestoneFor(memoryAgeDays),
    active_start_approximate: snapshot.approximate,
    generated_at: clock.toISOString(),
  };

  if (useCache) writeCache(home, nowTime, result);
  return { ...result, from_cache: false };
}
