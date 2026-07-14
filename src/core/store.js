import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { withReviewLock } from "./review-lock.js";
import { ERR, STATUS, assertTransition, claimHash } from "./schema.js";

const EVENT_STATUS = Object.freeze({
  "fact.superseded": STATUS.SUPERSEDED,
  "fact.invalidated": STATUS.INVALIDATED,
  "fact.archived": STATUS.ARCHIVED,
  "fact.restored": STATUS.ACTIVE,
});

const PATCHABLE_FIELDS = Object.freeze([
  "type",
  "scope",
  "subject",
  "claim",
  "confidence",
  "provenance",
  "t_valid",
  "t_invalid",
  "t_created",
  "t_expired",
  "superseded_by",
  "claim_hash",
]);

function codedError(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function isBusy(error) {
  return error?.code === "SQLITE_BUSY" || error?.code === "SQLITE_LOCKED";
}

function serializeProvenance(value) {
  return JSON.stringify(value ?? {});
}

function hydrate(row) {
  if (!row) return null;
  let provenance = {};
  try {
    provenance = JSON.parse(row.provenance);
  } catch {
    provenance = {};
  }
  return { ...row, provenance };
}

function completeFact(fact, at) {
  return {
    id: fact.id,
    type: fact.type,
    scope: fact.scope,
    subject: fact.subject ?? "",
    claim: fact.claim,
    confidence: fact.confidence,
    provenance: fact.provenance ?? {},
    t_valid: fact.t_valid,
    t_invalid: fact.t_invalid ?? null,
    t_created: fact.t_created ?? at,
    t_expired: fact.t_expired ?? null,
    superseded_by: fact.superseded_by ?? null,
    status: fact.status ?? STATUS.ACTIVE,
    claim_hash: fact.claim_hash ?? claimHash(fact.claim),
  };
}

function purgedFactIds(event) {
  if (event?.ev !== "fact.purged" || !Array.isArray(event.fact_ids)) return [];
  return event.fact_ids.filter((id) => typeof id === "string" && id.length > 0);
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function hasPurgeTombstone(home, ids, at) {
  const directory = path.join(home, "events");
  for (const name of fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}\.jsonl$/u.test(file))
    .sort()) {
    for (const line of fs.readFileSync(path.join(directory, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const event = JSON.parse(line);
        if (event?.ev === "fact.purged"
          && event.at === at
          && sameIds(purgedFactIds(event), ids)) return true;
      } catch {
        // 손상된 기존 라인은 tombstone 일치 여부를 판정할 수 없으므로 무시한다.
      }
    }
  }
  return false;
}

function eventContainsPurgedContent(event, ids) {
  if (event?.ev === "fact.added" && ids.has(event.fact?.id)) return true;
  if (Object.hasOwn(EVENT_STATUS, event?.ev) && ids.has(event.id)) return true;
  if (isRememberActivityEvent(event)
    && ids.has(event.fact_id)
    && typeof event.claim === "string") return true;
  return isRecallEvent(event)
    && Array.isArray(event.hits)
    && event.hits.some((id) => ids.has(id))
    && typeof event.query === "string"
    && event.query.length > 0;
}

let atomicSequence = 0;

function writeAtomic(file, data) {
  atomicSequence += 1;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${atomicSequence}`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function scrubEventFiles(home, ids) {
  const directory = path.join(home, "events");
  let removed = 0;
  for (const name of fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}\.jsonl$/u.test(file))
    .sort()) {
    const file = path.join(directory, name);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const kept = [];
    let changed = false;
    for (const line of lines) {
      if (line.trim() === "") continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        kept.push(line);
        continue;
      }
      if (eventContainsPurgedContent(event, ids)) {
        changed = true;
        removed += 1;
      } else {
        kept.push(line);
      }
    }
    if (!changed) continue;
    const data = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
    writeAtomic(`${file}.bak`, data);
    writeAtomic(file, data);
  }
  return removed;
}

function removeReviewPairs(home, ids) {
  const file = path.join(home, "review", "queue.jsonl");
  if (!fs.existsSync(file)) return 0;
  return withReviewLock(home, () => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const kept = [];
    let removed = 0;
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        const pairIds = String(JSON.parse(line).pair_id ?? "").split(":");
        if (pairIds.some((id) => ids.has(id))) {
          removed += 1;
          continue;
        }
      } catch {
        // 손상된 기존 라인은 purge 대상 여부를 판정할 수 없으므로 보존한다.
      }
      kept.push(line);
    }
    if (removed > 0) {
      writeAtomic(file, kept.length === 0 ? "" : `${kept.join("\n")}\n`);
    }
    return removed;
  });
}

function isRecallEvent(event) {
  return event?.type === "recall" && event.ev === undefined;
}

function isRememberActivityEvent(event) {
  return event?.type === "remember" && event.ev === undefined;
}

function activityEvent(event) {
  if (isRecallEvent(event)) {
    return {
      type: "recall",
      query: typeof event.query === "string" ? event.query : "",
      scope: event.scope ?? null,
      hits: Array.isArray(event.hits) ? event.hits.filter((id) => typeof id === "string") : [],
      source: typeof event.source === "string" ? event.source : "core",
      at: event.at,
    };
  }
  if (isRememberActivityEvent(event)) {
    if (event.result !== "duplicate" || typeof event.claim !== "string") return null;
    return {
      type: "remember",
      result: "duplicate",
      claim: event.claim,
      source: typeof event.source === "string" ? event.source : "core",
      at: event.at,
      ...(typeof event.fact_id === "string" ? { fact_id: event.fact_id } : {}),
    };
  }
  if (event?.ev !== "fact.added" || !event.fact) return null;
  return {
    type: "remember",
    fact_id: event.fact.id,
    claim: event.fact.claim,
    scope: event.fact.scope,
    source: typeof event.source === "string"
      ? event.source
      : typeof event.fact.provenance?.source === "string"
        ? event.fact.provenance.source
        : "core",
    at: event.at,
  };
}

function* reverseLines(file) {
  const descriptor = fs.openSync(file, "r");
  const chunkSize = 64 * 1024;
  let position = fs.fstatSync(descriptor).size;
  let remainder = Buffer.alloc(0);
  try {
    while (position > 0) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      fs.readSync(descriptor, chunk, 0, length, position);
      const data = remainder.length === 0 ? chunk : Buffer.concat([chunk, remainder]);
      let end = data.length;
      let newline = data.lastIndexOf(0x0a, end - 1);
      while (newline >= 0) {
        if (newline + 1 < end) yield data.subarray(newline + 1, end).toString("utf8");
        end = newline;
        if (end === 0) break;
        newline = data.lastIndexOf(0x0a, end - 1);
      }
      remainder = Buffer.from(data.subarray(0, end));
    }
    if (remainder.length > 0) yield remainder.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

export class Store {
  constructor(home) {
    if (typeof home !== "string" || home.length === 0) {
      throw codedError(ERR.E_INVALID_INPUT);
    }

    this.home = path.resolve(home);
    this.indexPath = path.join(this.home, "index.sqlite");
    for (const directory of ["events", "review", "reports", "views", "daemon"]) {
      fs.mkdirSync(path.join(this.home, directory), { recursive: true });
    }
    this.open();
    const purgeJournal = path.join(this.home, "purge-journal.json");
    if (fs.existsSync(purgeJournal)) {
      this.recoverPurgeJournal(purgeJournal);
    }
    // 자가치유: 이전 세션에서 인덱스 반영이 실패한 흔적이 있으면 정본(events)에서 재구성
    const dirtyMarker = path.join(this.home, ".index-dirty");
    if (fs.existsSync(dirtyMarker)) {
      this.rebuild();
      fs.rmSync(dirtyMarker, { force: true });
    }
  }

  open() {
    this.db = new Database(this.indexPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        subject TEXT NOT NULL,
        claim TEXT NOT NULL,
        confidence REAL NOT NULL,
        provenance TEXT NOT NULL,
        t_valid TEXT NOT NULL,
        t_invalid TEXT,
        t_created TEXT NOT NULL,
        t_expired TEXT,
        superseded_by TEXT,
        status TEXT NOT NULL,
        claim_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS facts_scope_status_valid_idx
        ON facts(scope, status, t_valid DESC);
      CREATE INDEX IF NOT EXISTS facts_subject_idx ON facts(subject);
      CREATE INDEX IF NOT EXISTS facts_claim_hash_idx ON facts(claim_hash);
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts
        USING fts5(id UNINDEXED, claim, subject);
    `);
  }

  appendEvent(evt, { apply = true } = {}) {
    const at = typeof evt?.at === "string" ? evt.at : new Date().toISOString();
    const event = { ...evt, at };
    const month = /^\d{4}-\d{2}/.exec(at)?.[0];
    if (!month) throw codedError(ERR.E_INVALID_INPUT);
    const file = path.join(this.home, "events", `${month}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
    if (!apply) return event;
    try {
      this.applyEvent(event);
    } catch {
      // 정본(로그)은 이미 기록됨 — 인덱스만 뒤처진 상태. 호출자가 재시도해 이벤트를 중복 쌓지 않도록
      // 성공으로 처리하고, 마커를 남겨 다음 오픈 시 rebuild로 자가치유한다.
      fs.writeFileSync(path.join(this.home, ".index-dirty"), at);
    }
    return event;
  }

  applyEvent(evt) {
    // 활동 로그는 fact 이벤트와 같은 append-only 정본에 공존하지만 파생 인덱스 대상은 아니다.
    if (isRecallEvent(evt) || isRememberActivityEvent(evt)) return;
    try {
      const apply = this.db.transaction(() => {
        const tombstoneIds = purgedFactIds(evt);
        if (tombstoneIds.length > 0) {
          const placeholders = tombstoneIds.map(() => "?").join(", ");
          this.db.prepare(`DELETE FROM facts_fts WHERE id IN (${placeholders})`).run(...tombstoneIds);
          // invariant-allow: facts-delete — tombstone 집행(완전삭제의 rebuild 방어선, CAPTURE-SPEC §1.4)
          this.db.prepare(`DELETE FROM facts WHERE id IN (${placeholders})`).run(...tombstoneIds);
          return;
        }

        if (evt?.ev === "fact.added") {
          const fact = completeFact(evt.fact, evt.at);
          const result = this.db.prepare(`
            INSERT OR IGNORE INTO facts (
              id, type, scope, subject, claim, confidence, provenance,
              t_valid, t_invalid, t_created, t_expired, superseded_by,
              status, claim_hash
            ) VALUES (
              @id, @type, @scope, @subject, @claim, @confidence, @provenance,
              @t_valid, @t_invalid, @t_created, @t_expired, @superseded_by,
              @status, @claim_hash
            )
          `).run({ ...fact, provenance: serializeProvenance(fact.provenance) });

          if (result.changes > 0 && fact.status === STATUS.ACTIVE) {
            this.db.prepare("INSERT INTO facts_fts(id, claim, subject) VALUES (?, ?, ?)")
              .run(fact.id, fact.claim, fact.subject);
          }
          return;
        }

        const status = EVENT_STATUS[evt?.ev];
        if (!status || typeof evt.id !== "string") {
          throw codedError(ERR.E_INVALID_INPUT);
        }

        const patch = evt.patch ?? {};
        const fields = PATCHABLE_FIELDS.filter((field) => Object.hasOwn(patch, field));
        const assignments = fields.map((field) => `${field} = @${field}`);
        assignments.push("status = @status");
        const values = { id: evt.id, status };
        for (const field of fields) {
          values[field] = field === "provenance" ? serializeProvenance(patch[field]) : patch[field];
        }

        this.db.prepare(`UPDATE facts SET ${assignments.join(", ")} WHERE id = @id`).run(values);
        this.db.prepare("DELETE FROM facts_fts WHERE id = ?").run(evt.id);

        if (status === STATUS.ACTIVE) {
          const fact = this.db.prepare("SELECT id, claim, subject FROM facts WHERE id = ?").get(evt.id);
          if (fact) {
            this.db.prepare("INSERT INTO facts_fts(id, claim, subject) VALUES (?, ?, ?)")
              .run(fact.id, fact.claim, fact.subject);
          }
        }
      });
      apply();
    } catch (error) {
      if (isBusy(error)) throw codedError(ERR.E_STORE_BUSY, error);
      throw error;
    }
  }

  addFact(fact) {
    const at = new Date().toISOString();
    const complete = completeFact(fact, at);
    const source = typeof complete.provenance?.source === "string"
      ? complete.provenance.source
      : "core";
    this.appendEvent({ ev: "fact.added", type: "remember", source, at, fact: complete });
    return this.getFact(complete.id);
  }

  appendRecall({ query = "", scope, hits = [], source = "core", at } = {}) {
    return this.appendEvent({
      type: "recall",
      query: typeof query === "string" ? query : "",
      scope: scope ?? null,
      hits: Array.isArray(hits) ? hits.filter((id) => typeof id === "string") : [],
      source: typeof source === "string" && source.trim() !== "" ? source : "core",
      ...(typeof at === "string" ? { at } : {}),
    });
  }

  activity({ since, limit = 200 } = {}) {
    const hasSince = since !== undefined;
    let sinceTime = Number.NEGATIVE_INFINITY;
    if (hasSince) {
      sinceTime = Date.parse(since);
      if (typeof since !== "string" || !Number.isFinite(sinceTime)) {
        throw codedError(ERR.E_INVALID_INPUT);
      }
    }
    const eventsDirectory = path.join(this.home, "events");
    const sinceMonth = Number.isFinite(sinceTime)
      ? new Date(sinceTime).toISOString().slice(0, 7)
      : null;
    const files = fs.readdirSync(eventsDirectory)
      .filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file))
      .filter((file) => sinceMonth === null || file.slice(0, 7) >= sinceMonth)
      .sort()
      .reverse();
    const eventLimit = Math.max(0, Math.trunc(limit));
    if (eventLimit === 0) return [];
    const events = [];
    for (const file of files) {
      for (const line of reverseLines(path.join(eventsDirectory, file))) {
        if (line.trim() === "") continue;
        let raw;
        try {
          raw = JSON.parse(line);
        } catch {
          continue;
        }
        const atTime = Date.parse(raw?.at);
        if (!Number.isFinite(atTime) || atTime <= sinceTime) continue;
        const event = activityEvent(raw);
        if (event) events.push(event);
        if (events.length >= eventLimit) return events.reverse();
      }
    }
    return events.reverse();
  }

  transition(id, to, patch = {}, actor) {
    const current = this.getFact(id);
    if (!current) throw codedError(ERR.E_NOT_FOUND);
    assertTransition(current.status, to, actor);

    const eventName = to === STATUS.ACTIVE ? "fact.restored" : `fact.${to}`;
    this.appendEvent({
      ev: eventName,
      at: new Date().toISOString(),
      id,
      patch,
    });
    return this.getFact(id);
  }

  getFact(id) {
    return hydrate(this.db.prepare("SELECT * FROM facts WHERE id = ?").get(id));
  }

  byHash(hash) {
    return hydrate(this.db.prepare(`
      SELECT * FROM facts
      WHERE claim_hash = ?
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, t_created DESC, id DESC
      LIMIT 1
    `).get(hash));
  }

  query({ scope, subject, status, limit } = {}) {
    const where = [];
    const params = {};
    if (scope !== undefined) {
      where.push("scope = @scope");
      params.scope = scope;
    }
    if (subject !== undefined) {
      where.push("subject = @subject");
      params.subject = subject;
    }
    if (status !== undefined) {
      where.push("status = @status");
      params.status = status;
    }

    let sql = "SELECT * FROM facts";
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY t_valid DESC, t_created DESC, id DESC";
    if (limit !== undefined) {
      sql += " LIMIT @limit";
      params.limit = Math.max(0, Math.trunc(limit));
    }
    const statement = this.db.prepare(sql);
    const rows = Object.keys(params).length > 0 ? statement.all(params) : statement.all();
    return rows.map(hydrate);
  }

  searchFts(text, { scope, limit = 30 } = {}) {
    if (typeof text !== "string") return [];
    const tokens = text.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (tokens.length === 0) return [];
    // 프리픽스 매칭: 한국어 조사가 붙은 토큰("포트는")도 어간 질의("포트")로 잡히게
    const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR ");
    const params = { match, limit: Math.max(0, Math.trunc(limit)) };
    let sql = `
      SELECT facts_fts.id AS id, bm25(facts_fts) AS rank
      FROM facts_fts
      JOIN facts ON facts.id = facts_fts.id
      WHERE facts_fts MATCH @match AND facts.status = 'active'
    `;
    if (scope !== undefined) {
      sql += " AND facts.scope = @scope";
      params.scope = scope;
    }
    sql += " ORDER BY rank ASC, facts_fts.id ASC LIMIT @limit";

    try {
      return this.db.prepare(sql).all(params);
    } catch (error) {
      if (isBusy(error)) throw codedError(ERR.E_STORE_BUSY, error);
      throw error;
    }
  }

  purge(ids, { source = "core" } = {}) {
    if (!Array.isArray(ids)
      || ids.some((id) => typeof id !== "string" || id.length === 0)
      || typeof source !== "string"
      || source.trim() === "") {
      throw codedError(ERR.E_INVALID_INPUT);
    }
    const factIds = [...new Set(ids)];
    if (factIds.length === 0) {
      return { ok: true, purged: 0, fact_ids: [], scrubbed_events: 0, review_pairs_removed: 0 };
    }
    const journal = path.join(this.home, "purge-journal.json");
    const at = new Date().toISOString();
    writeAtomic(journal, `${JSON.stringify({ ids: factIds, at })}\n`);
    try {
      const result = this.runPurgeSteps(factIds, { at, source: source.trim() });
      fs.rmSync(journal, { force: true });
      return result;
    } catch (error) {
      if (isBusy(error)) throw codedError(ERR.E_STORE_BUSY, error);
      throw error;
    }
  }

  runPurgeSteps(factIds, { at, source }) {
    if (!hasPurgeTombstone(this.home, factIds, at)) {
      this.appendEvent({
        ev: "fact.purged",
        fact_ids: factIds,
        source,
        at,
      }, { apply: false });
    }
    const idSet = new Set(factIds);
    const scrubbedEvents = scrubEventFiles(this.home, idSet);
    const removeRows = this.db.transaction(() => {
      const placeholders = factIds.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM facts_fts WHERE id IN (${placeholders})`).run(...factIds);
      // invariant-allow: facts-delete — 유저 명시 purge(완전삭제, CAPTURE-SPEC §1.4)
      return this.db.prepare(`DELETE FROM facts WHERE id IN (${placeholders})`).run(...factIds).changes;
    });
    const purged = removeRows();
    const reviewPairsRemoved = removeReviewPairs(this.home, idSet);
    return {
      ok: true,
      purged,
      fact_ids: factIds,
      scrubbed_events: scrubbedEvents,
      review_pairs_removed: reviewPairsRemoved,
    };
  }

  recoverPurgeJournal(journal) {
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(journal, "utf8"));
    } catch (error) {
      throw codedError(ERR.E_INVALID_INPUT, error);
    }
    if (!Array.isArray(entry?.ids)
      || entry.ids.some((id) => typeof id !== "string" || id.length === 0)
      || typeof entry.at !== "string") {
      throw codedError(ERR.E_INVALID_INPUT);
    }
    const factIds = [...new Set(entry.ids)];
    if (factIds.length > 0) {
      this.runPurgeSteps(factIds, { at: entry.at, source: "recovery" });
    }
    fs.rmSync(journal, { force: true });
  }

  rebuild() {
    this.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${this.indexPath}${suffix}`, { force: true });
    }
    this.open();

    const eventsDirectory = path.join(this.home, "events");
    const files = fs.readdirSync(eventsDirectory)
      .filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file))
      .sort();
    for (const file of files) {
      const lines = fs.readFileSync(path.join(eventsDirectory, file), "utf8").split("\n");
      for (const line of lines) {
        if (line.trim() !== "") this.applyEvent(JSON.parse(line));
      }
    }
    return this.stats();
  }

  stats() {
    const total = this.db.prepare("SELECT count(*) AS count FROM facts").get().count;
    const byStatus = {};
    const byScope = {};
    for (const row of this.db.prepare("SELECT status, count(*) AS count FROM facts GROUP BY status").all()) {
      byStatus[row.status] = row.count;
    }
    for (const row of this.db.prepare("SELECT scope, count(*) AS count FROM facts GROUP BY scope").all()) {
      byScope[row.scope] = row.count;
    }
    return { total, byStatus, byScope };
  }

  close() {
    if (this.db?.open) this.db.close();
  }
}

export function purgeByProvenance(store, predicate) {
  if (!(store instanceof Store) || typeof predicate !== "function") {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  const ids = store.query()
    .filter((fact) => predicate(fact.provenance, fact))
    .map((fact) => fact.id);
  return store.purge(ids, { source: "provenance" });
}
