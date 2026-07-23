import fs from "node:fs";
import path from "node:path";
import { readLogicalEvents } from "./store.js";

const DAY_MS = 86_400_000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ORGANIZED_STATUSES = new Set(["answered", "dismissed", "routed"]);

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

// TASK-BATCH-FIX (F-7): consume the ev_id first-wins logical reader (same one audit uses) so a
// duplicated ev_id line does not double-count recalls/deltas versus audit. The per-caller inWindow
// filter still scopes results to the receipt window; cutoff/now are kept for signature stability.
function eventsFor(home, cutoff, now) {
  void cutoff;
  void now;
  if (!fs.existsSync(path.join(home, "events"))) return [];
  return readLogicalEvents(home)
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
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

export function buildReceipt(home, store, { days = 7, now, installed: installedOpt } = {}) {
  const windowDays = Number.isFinite(Number(days)) && Number(days) > 0
    ? Number(days)
    : 7;
  const clock = now === undefined ? new Date() : new Date(now);
  if (!Number.isFinite(clock.getTime())) throw new TypeError("Invalid receipt clock");
  const nowTime = clock.getTime();
  const cutoff = nowTime - windowDays * DAY_MS;
  const events = eventsFor(home, cutoff, nowTime);
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
  const queue = readJsonLines(path.join(home, "review", "queue.jsonl"));
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
  for (const event of events) {
    if (!inWindow(event.at, cutoff, nowTime)) continue;
    if (event.ev === "fact.added"
      && (event.fact?.status === undefined || event.fact?.status === "active")) {
      factsDelta += 1;
    } else if (event.ev === "fact.invalidated" || event.ev === "fact.superseded") {
      factsDelta -= 1;
    }
  }

  let selfCorrected = 0;
  for (const event of events) {
    if (!inWindow(event.at, cutoff, nowTime)) continue;
    if (event.ev === "fact.superseded" || event.ev === "fact.invalidated") {
      selfCorrected += 1;
    }
  }

  // 큰 숫자를 실물로 뒷받침하는 표본: 윈도우 내 최근 recall 3건 + 사용된 기억 원문 일부
  const evidence = recallSamples
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

  const installed = installedOpt !== undefined ? installedOpt : installDate(home);
  const memoryAgeDays = installed != null
    ? Math.max(1, Math.ceil((nowTime - installed) / DAY_MS))
    : null;

  const conversationCount = conversations.size;
  const organized = handledByPair.size;
  const factsActive = activeCount(store);
  const corpusTokens = Math.ceil(corpusChars(store) / 4);
  const factsActiveAtStart = Math.max(0, factsActive - factsDelta);
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
    facts_delta: factsDelta,
    self_corrected: selfCorrected,
    corrected_examples: correctedExamples(events, store, cutoff, nowTime),
    evidence,
    memory_age_days: memoryAgeDays,
    installed_at: installed != null ? new Date(installed).toISOString() : null,
    sample_ok: conversationCount >= 3,
    activity,
  };
}

const RECEIPT_WINDOWS = [2, 7, 30];

const CHAMBER_MILESTONES = [
  { days: 7, ko: "첫 번째 방", en: "First Chamber", ja: "最初の部屋" },
  { days: 30, ko: "두 번째 방", en: "Second Chamber", ja: "二番目の部屋" },
  { days: 100, ko: "세 번째 방", en: "Third Chamber", ja: "三番目の部屋" },
  { days: 365, ko: "네 번째 방", en: "Fourth Chamber", ja: "四番目の部屋" },
];

// TODO(perf): 월파일 ≥ 3개 시 summary-cache.json 도입 — 4회 풀 스캔 대신 캐시 집계
export function buildReceiptMulti(home, store, { now } = {}) {
  const clock = now === undefined ? new Date() : new Date(now);
  const nowTime = clock.getTime();
  const installed = installDate(home);
  const lifetimeDays = installed != null
    ? Math.max(1, Math.ceil((nowTime - installed) / DAY_MS))
    : 30;

  const windows = {};
  for (const d of RECEIPT_WINDOWS) {
    windows[`${d}d`] = buildReceipt(home, store, { days: d, now, installed });
  }
  windows.lifetime = buildReceipt(home, store, { days: lifetimeDays, now, installed });
  windows.lifetime.is_lifetime = true;

  const memoryAgeDays = installed != null ? lifetimeDays : null;
  let milestone = null;
  if (memoryAgeDays != null) {
    for (let i = CHAMBER_MILESTONES.length - 1; i >= 0; i--) {
      if (memoryAgeDays >= CHAMBER_MILESTONES[i].days) {
        milestone = CHAMBER_MILESTONES[i];
        const nextM = CHAMBER_MILESTONES[i + 1] || null;
        milestone = { ...milestone, next: nextM };
        break;
      }
    }
  }

  return {
    windows,
    installed_at: installed != null ? new Date(installed).toISOString() : null,
    memory_age_days: memoryAgeDays,
    milestone,
    generated_at: clock.toISOString(),
  };
}
