import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { withReviewLock } from "./review-lock.js";
import { ERR, STATUS, assertTransition, claimHash, newEventId } from "./schema.js";

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

// TASK-001: rebuild 크로스프로세스 자문 락 — SQLite 파괴/재생성이 동시 프로세스와 겹치지 않게.
function rebuildLockPath(home) {
  return path.join(home, ".index-rebuild.lock");
}

// TASK-001: 락이 잡혀 있으면(다른 프로세스가 rebuild 중) true. 단일 프로세스는 rebuild가
// 동기라 자기 자신과 겹칠 수 없으므로, 존재하는 락은 항상 타 프로세스 소유를 뜻한다.
function rebuildInProgress(home) {
  return fs.existsSync(rebuildLockPath(home));
}

// TASK-001: 기존 락이 '증명 가능하게 죽은' PID의 것일 때만 회수한다.
// 살아있거나(kill 0이 안 던짐/EPERM) 읽을 수 없는 소유자는 회수하지 않는다.
function reclaimIfDeadOwner(lockPath) {
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return false; // 읽기 불가/손상 → 살아있는 소유자로 간주(회수 금지).
  }
  const pid = owner?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false; // 예외 없음 → 프로세스 생존(회수 금지).
  } catch (error) {
    if (error?.code !== "ESRCH") return false; // EPERM 등 → 소유자 존재로 간주.
    try {
      fs.rmSync(lockPath, { force: true }); // 확정적으로 죽음 → 스테일 락 제거.
    } catch {
      // 다른 프로세스가 먼저 제거했을 수 있음 — 무시.
    }
    return true;
  }
}

// TASK-001: 락 획득 — fs.openSync(path,"wx",0o600)로 원자적 배타 생성.
// EEXIST면 죽은 소유자만 회수하고 재시도, 아니면 E_STORE_BUSY로 실패한다.
function acquireRebuildLock(home) {
  const lockPath = rebuildLockPath(home);
  while (true) {
    let fd;
    try {
      fd = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (reclaimIfDeadOwner(lockPath)) continue; // 스테일 회수 후 재시도.
      throw codedError(ERR.E_STORE_BUSY, error); // 살아있는/불명 소유자.
    }
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    } finally {
      fs.closeSync(fd);
    }
    return lockPath;
  }
}

// TASK-001: 락 해제 — 항상 finally에서 호출(베스트에포트).
function releaseRebuildLock(lockPath) {
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // 베스트에포트 해제 — 실패해도 다음 획득 시 스테일 회수로 복구된다.
  }
}

// TASK-001: dirty 마커 원문 읽기 — 없으면 null(rebuild의 스냅샷 비교용).
function readDirtyMarkerRaw(home) {
  try {
    return fs.readFileSync(path.join(home, ".index-dirty"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

// TASK-001: dirty 마커를 원자적으로(같은 디렉터리 temp + rename) 쓴다.
// JSON {at, ev_id, reason} — 부분 JSON을 절대 관측시키지 않는다.
function writeDirtyMarker(home, { at, ev_id = null, reason }) {
  writeAtomic(path.join(home, ".index-dirty"), JSON.stringify({ at, ev_id: ev_id ?? null, reason }));
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
        const entry = JSON.parse(line);
        const pairIds = String(entry.pair_id ?? "").split(":");
        if (ids.has(entry.fact_id) || pairIds.some((id) => ids.has(id))) {
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

function isCaptureDecidedEvent(event) {
  return event?.ev === "capture.decided";
}

function activityEvent(event) {
  if (isRecallEvent(event)) {
    return {
      type: "recall",
      query: typeof event.query === "string" ? event.query : "",
      scope: event.scope ?? null,
      hits: Array.isArray(event.hits) ? event.hits.filter((id) => typeof id === "string") : [],
      source: typeof event.source === "string" ? event.source : "core",
      ...(typeof event.tool === "string" && event.tool ? { tool: event.tool } : {}),
      ...(typeof event.session_id === "string" && event.session_id ? { session_id: event.session_id } : {}),
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

// TASK-104: 이벤트 정본을 파일명(월)→라인 순서로 그대로 읽는다(멱등 처리 없음).
// 순서 규칙은 스펙 §3 — at은 표시용이고 라인 순서가 정본이다.
export function readEventLog(home) {
  const directory = path.join(home, "events");
  if (!fs.existsSync(directory)) return [];
  const events = [];
  for (const name of fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}\.jsonl$/u.test(file))
    .sort()) {
    for (const line of fs.readFileSync(path.join(directory, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // 손상된 라인은 리플레이/감사에서 건너뛴다(정본 파일은 손대지 않는다).
      }
    }
  }
  return events;
}

// TASK-104: ev_id 기준 첫 등장 우선(멱등). ev_id 없는 레거시 라인은 전부 개별 유지.
// TASK-105가 이 논리 리더를 그대로 소비한다 — 로직 복붙 금지, 이 함수를 호출할 것.
export function firstWinsEvents(events) {
  const seen = new Set();
  const logical = [];
  for (const event of events) {
    const evId = typeof event?.ev_id === "string" && event.ev_id !== "" ? event.ev_id : null;
    if (evId !== null) {
      if (seen.has(evId)) continue;
      seen.add(evId);
    }
    logical.push(event);
  }
  return logical;
}

// TASK-104: 홈의 이벤트 정본을 ev_id 첫-등장-우선으로 읽는 논리 리더(rebuild·감사 공용).
export function readLogicalEvents(home) {
  return firstWinsEvents(readEventLog(home));
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
    // TASK-001: 생성자 복구와 명시적 rebuild()는 동일 락 경로·구현을 공유한다(한 함수, 두 호출자).
    // 마커 삭제도 rebuild() 안에서 '변경되지 않았을 때만' 처리하므로 여기서 rmSync 하지 않는다.
    if (fs.existsSync(path.join(this.home, ".index-dirty"))) {
      this.rebuild();
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
    // TASK-104: 호출자가 준 비어있지 않은 ev_id는 보존, 아니면 직렬화 전에 자동 발급.
    const ev_id = typeof evt?.ev_id === "string" && evt.ev_id.trim() !== ""
      ? evt.ev_id
      : newEventId();
    const event = { ...evt, ev_id, at };
    const month = /^\d{4}-\d{2}/.exec(at)?.[0];
    if (!month) throw codedError(ERR.E_INVALID_INPUT);
    const file = path.join(this.home, "events", `${month}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
    if (!apply) return event;
    // TASK-001: rebuild가 진행 중(다른 프로세스가 락 보유)이면 인덱스 변이를 건너뛰고
    // 더 새로운 마커를 남긴다 — 진행 중/다음 rebuild가 이 이벤트를 리플레이하도록.
    // (이 프로세스의 SQLite 핸들은 rebuild가 삭제·재생성 중인 파일을 가리킬 수 있어 위험하다.)
    if (rebuildInProgress(this.home)) {
      writeDirtyMarker(this.home, { at, ev_id, reason: "append-during-rebuild" });
      return event;
    }
    try {
      this.applyEvent(event);
    } catch {
      // 정본(로그)은 이미 기록됨 — 인덱스만 뒤처진 상태. 호출자가 재시도해 이벤트를 중복 쌓지 않도록
      // 성공으로 처리하고, 마커를 남겨 다음 오픈 시 rebuild로 자가치유한다.
      // TASK-001: 마커는 원자적 JSON {at, ev_id, reason}로 기록한다.
      writeDirtyMarker(this.home, { at, ev_id, reason: "apply-failed" });
    }
    return event;
  }

  applyEvent(evt) {
    // 활동 로그는 fact 이벤트와 같은 append-only 정본에 공존하지만 파생 인덱스 대상은 아니다.
    if (isRecallEvent(evt) || isRememberActivityEvent(evt) || isCaptureDecidedEvent(evt)) return;
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
        // 알 수 없는 ev = fact 변이가 아닌 활동/텔레메트리 이벤트(recall·capture.decided·
        // shadow.resolve_cycle 등)로 fact 이벤트와 append-only 정본을 공유하지만 파생 인덱스
        // 대상이 아니다. rebuild를 오염시키지 않게 throw 대신 스킵한다(새 텔레메트리 ev가 추가돼도
        // 스킵 화이트리스트 갱신을 잊어 rebuild가 죽는 재발 footgun 차단, 사고 2026-07-19).
        if (!status) return;
        // EVENT_STATUS를 가진 정식 fact 변이 이벤트인데 id가 없으면 정본 손상 — 그대로 실패시킨다.
        if (typeof evt.id !== "string") {
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

  appendRecall({
    tool,
    query = "",
    scope,
    hits = [],
    source = "core",
    returned_chars,
    session_id,
    at,
  } = {}) {
    return this.appendEvent({
      type: "recall",
      tool: typeof tool === "string" && tool.trim() !== "" ? tool.trim() : "recall",
      query: typeof query === "string" ? query : "",
      scope: scope ?? null,
      hits: Array.isArray(hits) ? hits.filter((id) => typeof id === "string") : [],
      source: typeof source === "string" && source.trim() !== "" ? source : "core",
      ...(Number.isFinite(returned_chars) && returned_chars >= 0
        ? { returned_chars: Math.trunc(returned_chars) }
        : {}),
      // TASK-104: session_id는 항상 기록한다 — 빈값/미상은 정확히 "unknown"으로.
      // 이후 필드 자체의 부재는 오직 레거시 데이터만 가리킨다(§2 G1 해소).
      session_id: typeof session_id === "string" && session_id.trim() !== ""
        ? session_id.trim()
        : "unknown",
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

  transition(id, to, patch = {}, actor, { reason, policy_version } = {}) {
    const current = this.getFact(id);
    if (!current) throw codedError(ERR.E_NOT_FOUND);
    assertTransition(current.status, to, actor);

    const eventName = to === STATUS.ACTIVE ? "fact.restored" : `fact.${to}`;
    const event = {
      ev: eventName,
      at: new Date().toISOString(),
      id,
      patch,
    };
    // TASK-104: superseded/invalidated 판정 이벤트는 항상 비어있지 않은
    // actor/reason/policy_version을 담는다(§2 갭 G3). 지정 안 되면 "n/a"로 채운다.
    if (eventName === "fact.superseded" || eventName === "fact.invalidated") {
      event.actor = actor;
      event.reason = typeof reason === "string" && reason.trim() !== "" ? reason : "n/a";
      event.policy_version = typeof policy_version === "string" && policy_version.trim() !== ""
        ? policy_version
        : "n/a";
    }
    this.appendEvent(event);
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

  // TASK-104: ev_id 첫-등장-우선 논리 리더(rebuild·감사 읽기 공용 API).
  logicalEvents() {
    return readLogicalEvents(this.home);
  }

  rebuild() {
    // TASK-001: SQLite를 닫기 전에 크로스프로세스 락을 획득한다. 삭제·재오픈·리플레이·
    // 마커 정리까지 락을 유지하고, 어떤 경로로 빠져나가든 finally에서 반드시 해제한다.
    const lockPath = acquireRebuildLock(this.home);
    try {
      // TASK-001: 리플레이 전 dirty 마커 원문을 스냅샷한다. 리플레이 중 도착한 append가
      // 더 새로운 마커를 남겼다면(내용 변경) 삭제하지 않아 다음 rebuild가 이어받는다.
      const markerBefore = readDirtyMarkerRaw(this.home);

      this.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(`${this.indexPath}${suffix}`, { force: true });
      }
      this.open();

      // TASK-104: 리플레이는 ev_id 기준 멱등 — 같은 ev_id 재등장 시 1회만 적용,
      // ev_id 없는 레거시 라인은 전부 개별 적용된다(§3).
      for (const event of readLogicalEvents(this.home)) {
        this.applyEvent(event);
      }

      // TASK-001: 스냅샷과 동일할 때만 마커를 지운다(우리가 리플레이한 것만 청소).
      if (markerBefore !== null && readDirtyMarkerRaw(this.home) === markerBefore) {
        fs.rmSync(path.join(this.home, ".index-dirty"), { force: true });
      }
      return this.stats();
    } finally {
      releaseRebuildLock(lockPath);
    }
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
