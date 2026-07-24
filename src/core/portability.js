// TASK-098
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recall } from "./recall.js";
import { FACT_TYPES } from "./gate.js";
import { ERR, STATUS, claimHash, validScope } from "./schema.js";
import { Store } from "./store.js";

export const EXPORT_FORMAT = "nautli-export/1";
// TASK-107: Keep export construction bounded before JSON snapshot allocation.
export const MAX_EXPORT_BYTES = 256 * 1024 * 1024;

export const LOGICAL_FACT_FIELDS = Object.freeze([
  "id",
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
  "status",
  "claim_hash",
]);

const NULLABLE_FACT_FIELDS = new Set([
  "t_invalid",
  "t_expired",
  "superseded_by",
]);

const STRING_FACT_FIELDS = new Set([
  "id",
  "type",
  "scope",
  "subject",
  "claim",
  "t_valid",
  "t_created",
  "status",
  "claim_hash",
]);

const KNOWN_STATUSES = new Set(Object.values(STATUS));

// TASK-098
function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// TASK-098
function portabilityError(message, code = ERR.E_INVALID_INPUT) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// TASK-098
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// TASK-098
function canonicalSerialize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw portabilityError("Export schema error: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalSerialize(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
      .join(",")}}`;
  }
  throw portabilityError(`Export schema error: unsupported value type ${typeof value}`);
}

// TASK-098-fix
export function factChecksum(facts, events = []) {
  const ordered = [...facts].sort((left, right) => compareStrings(String(left.id), String(right.id)));
  return createHash("sha256")
    .update(canonicalSerialize({ facts: ordered, events }))
    .digest("hex");
}

// TASK-098-fix
function eventLogNames(home) {
  const directory = path.join(home, "events");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => /^\d{4}-\d{2}\.jsonl$/u.test(file))
    .sort();
}

// TASK-107: A pretty-printed JSON export expands JSONL events and SQLite rows;
// use a deliberately conservative on-disk estimate before loading either into memory.
function assertExportSizeWithinLimit(home, eventNames) {
  const eventBytes = eventNames.reduce(
    (total, name) => total + fs.statSync(path.join(home, "events", name)).size,
    0,
  );
  const indexBytes = ["index.sqlite", "index.sqlite-wal"]
    .map((name) => {
      try {
        return fs.statSync(path.join(home, name)).size;
      } catch (error) {
        if (error?.code === "ENOENT") return 0;
        throw error;
      }
    })
    .reduce((total, size) => total + size, 0);
  const estimatedBytes = eventBytes * 2 + indexBytes * 3;
  if (estimatedBytes > MAX_EXPORT_BYTES) {
    throw portabilityError(
      `Export estimate ${estimatedBytes} bytes exceeds ${MAX_EXPORT_BYTES} byte limit`,
      ERR.E_EXPORT_TOO_LARGE,
    );
  }
}

// TASK-098-fix
function readEvents(home) {
  const directory = path.join(home, "events");
  const events = [];
  const fileSizes = new Map();
  for (const name of eventLogNames(home)) {
    const contents = fs.readFileSync(path.join(directory, name));
    fileSizes.set(name, contents.byteLength);
    const lines = contents.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() === "") continue;
      try {
        events.push(JSON.parse(lines[index]));
      } catch {
        throw portabilityError(`Event log JSON is invalid: ${name}:${index + 1}`);
      }
    }
  }
  return { events, fileSizes };
}

// TASK-FIX-B12 (M-3): the pending review/contradiction queue is separate durable
// state (review/queue.jsonl) not derivable from the event log — carry it in exports
// so a pending contradiction survives a full export->import round trip.
function readReviewQueue(home) {
  const file = path.join(home, "review", "queue.jsonl");
  if (!fs.existsSync(file)) return [];
  const entries = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === "") continue;
    try {
      entries.push(JSON.parse(lines[index]));
    } catch {
      throw portabilityError(`Review queue JSON is invalid: review/queue.jsonl:${index + 1}`);
    }
  }
  return entries;
}

// TASK-098-fix
function resolveExportHome(home) {
  const resolved = path.resolve(home);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw portabilityError(
      `nautli home not found or empty: ${resolved} — nothing to export`,
    );
  }
  return fs.realpathSync(resolved);
}

// TASK-098-fix
function assertStoreUnchanged(store, home, expectedFactCount, expectedEventFileSizes) {
  try {
    if (store.query().length !== expectedFactCount) {
      throw portabilityError("store changed during export; retry");
    }
    const names = eventLogNames(home);
    if (names.length !== expectedEventFileSizes.size) {
      throw portabilityError("store changed during export; retry");
    }
    for (const name of names) {
      const expectedSize = expectedEventFileSizes.get(name);
      const actualSize = fs.statSync(path.join(home, "events", name)).size;
      if (expectedSize === undefined || actualSize !== expectedSize) {
        throw portabilityError("store changed during export; retry");
      }
    }
  } catch (error) {
    if (error?.message === "store changed during export; retry") throw error;
    throw portabilityError("store changed during export; retry");
  }
}

// TASK-098-fix
export function createExportSnapshot(
  home,
  exportedAt = new Date().toISOString(),
  { afterSnapshot } = {},
) {
  const requestedHome = path.resolve(home);
  const resolvedHome = resolveExportHome(home);
  const initialEventNames = eventLogNames(resolvedHome);
  if (initialEventNames.length === 0
    && !fs.existsSync(path.join(resolvedHome, "index.sqlite"))) {
    throw portabilityError(
      `nautli home not found or empty: ${requestedHome} — nothing to export`,
    );
  }
  // TASK-107: reject before Store.query()/event parsing can allocate an oversized snapshot.
  assertExportSizeWithinLimit(resolvedHome, initialEventNames);
  const store = new Store(resolvedHome);
  try {
    const facts = store.query()
      .sort((left, right) => compareStrings(left.id, right.id));
    const { events, fileSizes } = readEvents(resolvedHome);
    if (fileSizes.size === 0 && facts.length === 0) {
      throw portabilityError(
        `nautli home not found or empty: ${requestedHome} — nothing to export`,
      );
    }
    // TASK-FIX-B12 (M-3): pending review queue is not part of the fact/event checksum.
    const review = readReviewQueue(resolvedHome);
    afterSnapshot?.();
    assertStoreUnchanged(store, resolvedHome, facts.length, fileSizes);
    return {
      format: EXPORT_FORMAT,
      // TASK-FIX-B12 (M-3): minor version bump signals the optional `review` array;
      // legacy readers ignore unknown fields and legacy files (no review) import fine.
      minor: 1,
      exported_at: exportedAt,
      counts: { facts: facts.length, events: events.length },
      checksum: factChecksum(facts, events),
      facts,
      events,
      ...(review.length > 0 ? { review } : {}),
    };
  } finally {
    store.close();
  }
}

// TASK-098
function writeFileAtomic(file, contents) {
  const resolved = path.resolve(file);
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(
    parent,
    `.${path.basename(resolved)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    fs.writeFileSync(temporary, contents, "utf8");
    fs.renameSync(temporary, resolved);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return resolved;
}

// TASK-098-fix
function canonicalProspectiveOutput(file) {
  const resolved = path.resolve(file);
  let existingParent = path.dirname(resolved);
  const missingSegments = [path.basename(resolved)];
  while (!fs.existsSync(existingParent)) {
    missingSegments.unshift(path.basename(existingParent));
    const parent = path.dirname(existingParent);
    if (parent === existingParent) break;
    existingParent = parent;
  }
  return path.join(fs.realpathSync(existingParent), ...missingSegments);
}

// TASK-098-fix
function assertExportOutputOutsideHome(home, file) {
  const resolvedHome = resolveExportHome(home);
  const resolvedOutput = path.resolve(file);
  const relative = path.relative(resolvedHome, canonicalProspectiveOutput(resolvedOutput));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".."
    && !path.isAbsolute(relative))) {
    throw portabilityError("refusing to write export inside the nautli home");
  }
  return { resolvedHome, resolvedOutput };
}

// TASK-098-fix
export function writeExportFile(home, file, exportedAt) {
  const { resolvedOutput } = assertExportOutputOutsideHome(home, file);
  const snapshot = createExportSnapshot(home, exportedAt);
  const output = writeFileAtomic(resolvedOutput, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { output, snapshot };
}

// TASK-098
function validateFact(fact, index) {
  if (!isPlainObject(fact)) {
    throw portabilityError(`Export fact schema error at facts[${index}]: expected object`);
  }
  for (const field of LOGICAL_FACT_FIELDS) {
    if (!Object.hasOwn(fact, field)) {
      throw portabilityError(
        `Export fact schema error at facts[${index}]: missing required field "${field}"`,
      );
    }
  }
  for (const field of STRING_FACT_FIELDS) {
    if (typeof fact[field] !== "string") {
      throw portabilityError(
        `Export fact schema error at facts[${index}].${field}: expected string`,
      );
    }
  }
  for (const field of NULLABLE_FACT_FIELDS) {
    if (fact[field] !== null && typeof fact[field] !== "string") {
      throw portabilityError(
        `Export fact schema error at facts[${index}].${field}: expected string or null`,
      );
    }
  }
  if (typeof fact.confidence !== "number" || !Number.isFinite(fact.confidence)) {
    throw portabilityError(
      `Export fact schema error at facts[${index}].confidence: expected finite number`,
    );
  }
  // TASK-107: Import accepts only facts that the live store can safely reason about.
  if (fact.confidence < 0 || fact.confidence > 1) {
    throw portabilityError(
      `Export fact schema error at facts[${index}].confidence: expected number in [0,1]`,
    );
  }
  if (!validScope(fact.scope)) {
    throw portabilityError(
      `Export fact schema error at facts[${index}].scope: invalid scope "${fact.scope}"`,
    );
  }
  for (const field of ["t_valid", "t_created"]) {
    if (!Number.isFinite(Date.parse(fact[field]))) {
      throw portabilityError(
        `Export fact schema error at facts[${index}].${field}: invalid timestamp`,
      );
    }
  }
  for (const field of ["t_invalid", "t_expired"]) {
    if (fact[field] !== null && !Number.isFinite(Date.parse(fact[field]))) {
      throw portabilityError(
        `Export fact schema error at facts[${index}].${field}: invalid timestamp`,
      );
    }
  }
  const computedClaimHash = claimHash(fact.claim);
  if (fact.claim_hash !== computedClaimHash) {
    throw portabilityError(
      `Export fact schema error at facts[${index}].claim_hash: does not match claim`,
    );
  }
  if (!isPlainObject(fact.provenance)) {
    throw portabilityError(
      `Export fact schema error at facts[${index}].provenance: expected object`,
    );
  }
  if (!KNOWN_STATUSES.has(fact.status)) {
    throw portabilityError(
      `Export fact schema error at facts[${index}].status: unknown status "${fact.status}"`,
    );
  }
  // TASK-FIX-B12 (M-2): type must be one of the enum values the remember gate accepts;
  // an enum-invalid type must not enter the live store via import.
  if (!FACT_TYPES.has(fact.type)) {
    throw portabilityError(
      `Export fact schema error at facts[${index}].type: unknown type "${fact.type}"`,
    );
  }
}

// TASK-098
function validateEvent(event, index) {
  if (!isPlainObject(event)) {
    throw portabilityError(`Export event schema error at events[${index}]: expected object`);
  }
  if (typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at))) {
    throw portabilityError(
      `Export event schema error at events[${index}]: missing or invalid "at"`,
    );
  }
}

// TASK-098
export function validateExportSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) {
    throw portabilityError("Export schema error: expected a JSON object");
  }
  if (snapshot.format !== EXPORT_FORMAT) {
    throw portabilityError(`Unknown export format: ${String(snapshot.format)}`);
  }
  if (typeof snapshot.exported_at !== "string"
    || !Number.isFinite(Date.parse(snapshot.exported_at))) {
    throw portabilityError("Export schema error: exported_at must be an ISO timestamp");
  }
  if (!Array.isArray(snapshot.facts) || !Array.isArray(snapshot.events)) {
    throw portabilityError("Export schema error: facts and events must be arrays");
  }
  if (!isPlainObject(snapshot.counts)
    || !Number.isSafeInteger(snapshot.counts.facts)
    || !Number.isSafeInteger(snapshot.counts.events)
    || snapshot.counts.facts !== snapshot.facts.length
    || snapshot.counts.events !== snapshot.events.length) {
    throw portabilityError(
      `Export counts mismatch: declared facts=${String(snapshot.counts?.facts)}, `
      + `events=${String(snapshot.counts?.events)}; actual facts=${snapshot.facts.length}, `
      + `events=${snapshot.events.length}`,
    );
  }
  // TASK-FIX-B12 (M-3): review queue is optional; when present it must be an array
  // of objects each carrying a string pair_id (the store's queue invariant).
  if (snapshot.review !== undefined) {
    if (!Array.isArray(snapshot.review)) {
      throw portabilityError("Export schema error: review must be an array when present");
    }
    snapshot.review.forEach((entry, index) => {
      if (!isPlainObject(entry) || typeof entry.pair_id !== "string") {
        throw portabilityError(
          `Export review schema error at review[${index}]: expected object with string pair_id`,
        );
      }
    });
  }
  snapshot.facts.forEach((fact, index) => validateFact(fact, index));
  snapshot.events.forEach((event, index) => validateEvent(event, index));
  const factIds = new Set(snapshot.facts.map((fact) => fact.id));
  if (factIds.size !== snapshot.facts.length) {
    throw portabilityError("Export fact schema error: duplicate fact id");
  }
  // TASK-107: A supersession edge must resolve inside the imported snapshot.
  snapshot.facts.forEach((fact, index) => {
    if (fact.superseded_by !== null && !factIds.has(fact.superseded_by)) {
      throw portabilityError(
        `Export fact schema error at facts[${index}].superseded_by: dangling fact id "${fact.superseded_by}"`,
      );
    }
  });
  if (typeof snapshot.checksum !== "string") {
    throw portabilityError("Export schema error: checksum must be a string");
  }
  // TASK-098-fix
  const computed = factChecksum(snapshot.facts, snapshot.events);
  if (computed !== snapshot.checksum) {
    throw portabilityError(
      `Export checksum mismatch: declared ${snapshot.checksum}, computed ${computed}`,
    );
  }
  return {
    facts: snapshot.facts.length,
    events: snapshot.events.length,
    checksum: computed,
  };
}

// TASK-098
export function readExportFile(file) {
  // TASK-FIX-B12 (M-1): bound the on-disk file before reading it into memory.
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") throw portabilityError(`Export file not found: ${file}`);
    throw error;
  }
  if (stat.size > MAX_EXPORT_BYTES) {
    throw portabilityError(
      `Export file ${stat.size} bytes exceeds ${MAX_EXPORT_BYTES} byte limit`,
      ERR.E_EXPORT_TOO_LARGE,
    );
  }
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw portabilityError(`Export file not found: ${file}`);
    throw portabilityError(`Export JSON is truncated or invalid: ${error.message}`);
  }
  const integrity = validateExportSnapshot(snapshot);
  return { snapshot, integrity };
}

// TASK-098
function logicalFact(fact) {
  return Object.fromEntries(LOGICAL_FACT_FIELDS.map((field) => [field, fact[field]]));
}

// TASK-098
function differentFields(left, right) {
  return LOGICAL_FACT_FIELDS.filter(
    (field) => canonicalSerialize(left[field]) !== canonicalSerialize(right[field]),
  );
}

// TASK-098
export function compareFactSnapshots(expectedFacts, actualFacts) {
  const expected = new Map(expectedFacts.map((fact) => [fact.id, logicalFact(fact)]));
  const actual = new Map(actualFacts.map((fact) => [fact.id, logicalFact(fact)]));
  const missing = [...expected.keys()].filter((id) => !actual.has(id)).sort();
  const unexpected = [...actual.keys()].filter((id) => !expected.has(id)).sort();
  const changed = [...expected.keys()]
    .filter((id) => actual.has(id))
    .map((id) => ({ id, fields: differentFields(expected.get(id), actual.get(id)) }))
    .filter((entry) => entry.fields.length > 0)
    .sort((left, right) => compareStrings(left.id, right.id));
  return {
    equal: missing.length === 0 && unexpected.length === 0 && changed.length === 0,
    missing,
    unexpected,
    changed,
  };
}

// TASK-098
function factDiffSummary(diff) {
  const changed = diff.changed
    .slice(0, 5)
    .map((entry) => `${entry.id}(${entry.fields.join(",")})`)
    .join(", ");
  return [
    `missing=${diff.missing.length}${diff.missing.length ? ` [${diff.missing.slice(0, 5).join(", ")}]` : ""}`,
    `unexpected=${diff.unexpected.length}${diff.unexpected.length ? ` [${diff.unexpected.slice(0, 5).join(", ")}]` : ""}`,
    `changed=${diff.changed.length}${changed ? ` [${changed}]` : ""}`,
  ].join("; ");
}

// TASK-098
// TASK-107: An existing home is replaced only after the staging home validates.
function assertImportTargetUsable(target) {
  if (!fs.existsSync(target)) return false;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw portabilityError(`Import target home must be a directory or nonexistent: ${target}`);
  }
  return true;
}

// TASK-098
function makeStagingPath(target) {
  for (let sequence = 0; sequence < 100; sequence += 1) {
    const candidate = `${target}.tmp-${process.pid}-${Date.now()}-${sequence}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw portabilityError(`Could not allocate import staging home for: ${target}`);
}

// TASK-107: Backup names are sibling paths so both renames have one durable parent.
function makeBackupPath(target) {
  for (let sequence = 0; sequence < 100; sequence += 1) {
    const candidate = `${target}.bak-${process.pid}-${Date.now()}-${sequence}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw portabilityError(`Could not allocate import backup home for: ${target}`);
}

function fsyncPath(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncTree(root) {
  const directories = [];
  const visit = (entry) => {
    const stat = fs.lstatSync(entry);
    if (stat.isDirectory()) {
      directories.push(entry);
      for (const name of fs.readdirSync(entry).sort()) visit(path.join(entry, name));
      return;
    }
    if (!stat.isSymbolicLink()) fsyncPath(entry);
  };
  visit(root);
  for (const directory of directories.reverse()) fsyncPath(directory);
}

function removeDirectoryIfPresent(directory) {
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
}

// TASK-098
function writeImportedEvents(staging, events) {
  const directory = path.join(staging, "events");
  fs.mkdirSync(directory, { recursive: true });
  const byMonth = new Map();
  for (const event of events) {
    const month = event.at.slice(0, 7);
    const monthly = byMonth.get(month) ?? [];
    monthly.push(JSON.stringify(event));
    byMonth.set(month, monthly);
  }
  for (const [month, lines] of [...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const file = path.join(directory, `${month}.jsonl`);
    fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
    fsyncPath(file);
  }
  fsyncPath(directory);
}

// TASK-FIX-B12 (M-3): restore the pending review queue into the staging home so a
// round trip keeps markers/conflicts_with intact. Legacy snapshots omit `review`.
function writeImportedReview(staging, review) {
  if (!Array.isArray(review) || review.length === 0) return;
  const directory = path.join(staging, "review");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "queue.jsonl");
  fs.writeFileSync(file, `${review.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  fsyncPath(file);
  fsyncPath(directory);
}

function verifyImportedHome(home, snapshot) {
  let store;
  try {
    store = new Store(home);
    const diff = compareFactSnapshots(snapshot.facts, store.query());
    if (!diff.equal) {
      throw portabilityError(`Imported fact rows mismatch: ${factDiffSummary(diff)}`);
    }
    return snapshot.facts.length;
  } finally {
    store?.close();
  }
}

// TASK-098
export function importExportFile(file, targetHome) {
  const target = path.resolve(targetHome);
  const { snapshot, integrity } = readExportFile(file);
  const targetExisted = assertImportTargetUsable(target);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const staging = makeStagingPath(target);
  let store;
  let backup;
  let targetMoved = false;
  let replacementInstalled = false;
  // TASK-FIX-B12 (H-1): once the replacement is verified the live home is
  // authoritative — no later fault may restore a (possibly partial) backup over it.
  let verified = false;
  try {
    fs.mkdirSync(staging);
    writeImportedEvents(staging, snapshot.events);
    // TASK-FIX-B12 (M-3): stage the pending review queue before rebuild/verify.
    writeImportedReview(staging, snapshot.review);
    store = new Store(staging);
    store.rebuild();
    const actualFacts = store.query();
    const diff = compareFactSnapshots(snapshot.facts, actualFacts);
    if (!diff.equal) {
      throw portabilityError(`Imported fact rows mismatch: ${factDiffSummary(diff)}`);
    }
    store.close();
    store = undefined;
    // TASK-107: Flush all staged files and directories before any target mutation.
    fsyncTree(staging);
    if (targetExisted) {
      backup = makeBackupPath(target);
      fs.renameSync(target, backup);
      targetMoved = true;
      fsyncPath(parent);
    }
    fs.renameSync(staging, target);
    replacementInstalled = true;
    fsyncPath(parent);
    verifyImportedHome(target, snapshot);
    // TASK-FIX-B12 (H-1): verification succeeded — the replacement is the source of
    // truth from here on. A failure while removing the backup must NOT touch the live
    // replacement (the old bug deleted the verified home and restored a partly-deleted
    // backup). Leave the backup dir behind with a marker and return success + warning.
    verified = true;
    const warnings = [];
    if (backup) {
      const backupDir = backup;
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
        backup = undefined;
        fsyncPath(parent);
      } catch (cleanupError) {
        // Data is safe: the live home is verified. Do not attempt any restore.
        backup = undefined;
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        warnings.push(`backup cleanup incomplete (data safe): ${message}; backup left at ${backupDir}`);
        if (fs.existsSync(backupDir)) {
          try {
            fs.writeFileSync(
              path.join(backupDir, "README-NAUTLI-STALE-BACKUP.txt"),
              "This is a stale nautli import backup. The import SUCCEEDED and the live "
              + "home was verified; cleanup of this backup did not finish. This directory "
              + "is safe to delete manually.\n",
              "utf8",
            );
          } catch {
            // Best-effort marker only; absence does not affect data safety.
          }
        }
      }
    }
    return {
      home: target,
      counts: { facts: actualFacts.length, events: integrity.events },
      checksum: integrity.checksum,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  } catch (error) {
    store?.close();
    // TASK-FIX-B12 (H-1): only restore when the replacement was NOT yet verified.
    // TASK-107: Faults after target->backup never discard the original target.
    if (!verified && targetMoved && backup && fs.existsSync(backup)) {
      try {
        if (replacementInstalled) removeDirectoryIfPresent(target);
        fs.renameSync(backup, target);
        backup = undefined;
        fsyncPath(parent);
      } catch {
        // Preserve the original failure; the surviving sibling backup is recoverable.
      }
    } else if (!verified && !targetExisted && replacementInstalled) {
      try {
        removeDirectoryIfPresent(target);
        fsyncPath(parent);
      } catch {
        // Preserve the original failure; no original target existed to restore.
      }
    }
    removeDirectoryIfPresent(staging);
    throw error;
  }
}

// TASK-098
function queryTerms(fact) {
  return fact.claim.match(/[\p{L}\p{N}_]+/gu) ?? [];
}

// TASK-098
function representativeRecallQueries(facts) {
  const active = facts.filter((fact) => fact.status === STATUS.ACTIVE);
  const queries = [];
  const scopes = [...new Set(active.map((fact) => fact.scope))].sort(compareStrings);
  // TASK-107: Sample each scope deterministically with 1/2/3+ term queries and
  // a claim containing non-ASCII or emoji when present.
  for (const scope of scopes) {
    const scopeFacts = active
      .filter((fact) => fact.scope === scope)
      .sort((left, right) => compareStrings(left.id, right.id));
    for (const termCount of [1, 2, 3]) {
      const match = scopeFacts.find((fact) => queryTerms(fact).length >= termCount);
      if (match) {
        queries.push({ query: queryTerms(match).slice(0, termCount).join(" "), scope });
      }
    }
    const nonAscii = scopeFacts.find((fact) => /[^\x00-\x7F]/u.test(fact.claim));
    if (nonAscii) {
      queries.push({ query: nonAscii.claim, scope });
    }
    const emoji = scopeFacts.find((fact) => /\p{Extended_Pictographic}/u.test(fact.claim));
    if (emoji && emoji.id !== nonAscii?.id) {
      queries.push({ query: emoji.claim, scope });
    }
  }
  if (queries.length === 0) {
    queries.push(
      { query: "", scope: undefined },
      { query: "nautli", scope: undefined },
    );
  }
  return queries;
}

// TASK-098
function recallIds(store, query) {
  const readOnlyRecallStore = {
    searchFts: (...args) => store.searchFts(...args),
    getFact: (...args) => store.getFact(...args),
    query: (...args) => store.query(...args),
    appendRecall: () => {},
  };
  return recall(readOnlyRecallStore, query.query, {
    scope: query.scope,
    budget_tokens: 2000,
    top_k: 20,
    source: "export-verify",
  }).facts.map((fact) => fact.id);
}

// TASK-098
export function verifyRoundTrip(sourceHome, exportFile) {
  const { snapshot, integrity } = readExportFile(exportFile);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-export-verify-"));
  const importedHome = path.join(temporaryRoot, "home");
  let sourceStore;
  let importedStore;
  try {
    importExportFile(exportFile, importedHome);
    // TASK-098-fix
    const importedEvents = readEvents(importedHome).events;
    if (canonicalSerialize(importedEvents) !== canonicalSerialize(snapshot.events)) {
      throw portabilityError("Round-trip event rows mismatch");
    }
    sourceStore = new Store(sourceHome);
    importedStore = new Store(importedHome);
    const sourceFacts = sourceStore.query();
    const sourceSnapshotDiff = compareFactSnapshots(snapshot.facts, sourceFacts);
    if (!sourceSnapshotDiff.equal) {
      throw portabilityError(
        `Source fact rows changed after export: ${factDiffSummary(sourceSnapshotDiff)}`,
      );
    }
    const diff = compareFactSnapshots(sourceFacts, importedStore.query());
    if (!diff.equal) {
      throw portabilityError(`Round-trip fact rows mismatch: ${factDiffSummary(diff)}`);
    }
    const queries = representativeRecallQueries(snapshot.facts);
    for (const query of queries) {
      const sourceIds = recallIds(sourceStore, query);
      const importedIds = recallIds(importedStore, query);
      const sourceSet = [...new Set(sourceIds)].sort();
      const importedSet = [...new Set(importedIds)].sort();
      if (canonicalSerialize(sourceSet) !== canonicalSerialize(importedSet)) {
        throw portabilityError(
          `Round-trip recall fact-id set mismatch for "${query.query}" `
          + `(scope=${String(query.scope)})`,
        );
      }
      if (canonicalSerialize(sourceIds) !== canonicalSerialize(importedIds)) {
        throw portabilityError(
          `Round-trip recall top-k order mismatch for "${query.query}" `
          + `(scope=${String(query.scope)})`,
        );
      }
    }
    return {
      facts: integrity.facts,
      events: integrity.events,
      checksum: integrity.checksum,
      recall_queries: queries.length,
    };
  } finally {
    sourceStore?.close();
    importedStore?.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
