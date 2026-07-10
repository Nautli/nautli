import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
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

  appendEvent(evt) {
    const at = typeof evt?.at === "string" ? evt.at : new Date().toISOString();
    const event = { ...evt, at };
    const month = /^\d{4}-\d{2}/.exec(at)?.[0];
    if (!month) throw codedError(ERR.E_INVALID_INPUT);
    const file = path.join(this.home, "events", `${month}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
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
    try {
      const apply = this.db.transaction(() => {
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
    this.appendEvent({ ev: "fact.added", at, fact: complete });
    return this.getFact(complete.id);
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
