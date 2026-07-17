import fs from "node:fs";
import path from "node:path";

const DAY_MS = 86_400_000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const ORGANIZED_STATUSES = new Set(["answered", "dismissed", "routed"]);

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

function eventsFor(home, cutoff, now) {
  const directory = path.join(home, "events");
  if (!fs.existsSync(directory)) return [];
  const firstMonth = new Date(cutoff).toISOString().slice(0, 7);
  const lastMonth = new Date(now).toISOString().slice(0, 7);
  return fs.readdirSync(directory)
    .filter((name) => /^\d{4}-\d{2}\.jsonl$/u.test(name))
    .filter((name) => name.slice(0, 7) >= firstMonth && name.slice(0, 7) <= lastMonth)
    .sort()
    .flatMap((name) => readJsonLines(path.join(directory, name)));
}

function inWindow(value, cutoff, now) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= cutoff && time <= now;
}

function sessionId(event) {
  for (const field of ["session_id", "conversation_id", "session"]) {
    if (typeof event[field] === "string" && event[field].trim() !== "") {
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

export function buildReceipt(home, store, { days = 7, now } = {}) {
  const windowDays = Number.isFinite(Number(days)) && Number(days) > 0
    ? Number(days)
    : 7;
  const clock = now === undefined ? new Date() : new Date(now);
  if (!Number.isFinite(clock.getTime())) throw new TypeError("Invalid receipt clock");
  const nowTime = clock.getTime();
  const cutoff = nowTime - windowDays * DAY_MS;
  const events = eventsFor(home, cutoff, nowTime);
  const conversations = new Set();
  let approx = false;
  let tokensDelivered = 0;

  for (const event of events) {
    if (event.type !== "recall"
      || event.ev !== undefined
      || !Array.isArray(event.hits)
      || event.hits.length === 0
      || !inWindow(event.at, cutoff, nowTime)) continue;

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

  const conversationCount = conversations.size;
  const organized = handledByPair.size;
  const factsActive = activeCount(store);
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
    facts_delta: factsDelta,
    sample_ok: conversationCount >= 3,
    activity,
  };
}
