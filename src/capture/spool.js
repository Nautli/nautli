import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ERR } from "../core/schema.js";

const ID_PATTERN = /^\d{13}-[0-9a-f]{16}$/u;
const ENTRY_KEYS = new Set(["session_id", "transcript_path", "project", "at", "kind"]);
const STORED_KEYS = new Set([...ENTRY_KEYS, "id", "retry_count", "dead"]);
const MAX_FIELD_LENGTH = 4096;
const MAX_ENTRY_BYTES = 16384;
const MAX_SPOOL_ENTRIES = 1000;

function codedError(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function spoolDirectory(home) {
  if (typeof home !== "string" || home.length === 0) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  return path.join(path.resolve(home), "capture", "spool");
}

function ensureSpoolDirectory(home) {
  const directory = spoolDirectory(home);
  try {
    if (fs.lstatSync(directory).isSymbolicLink()) {
      throw codedError(ERR.E_INVALID_INPUT);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  fs.chmodSync(directory, 0o700);
  return directory;
}

function newSpoolId() {
  return `${String(Date.now()).padStart(13, "0")}-${randomBytes(8).toString("hex")}`;
}

function validId(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  return id;
}

export function writeSpoolEntry(home, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  const keys = Object.keys(entry);
  if (keys.some((key) => !ENTRY_KEYS.has(key))
    || keys.some((key) => typeof entry[key] !== "string" || entry[key].length > MAX_FIELD_LENGTH)) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  const directory = ensureSpoolDirectory(home);
  if (listSpoolEntries(home).length >= MAX_SPOOL_ENTRIES) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  const id = newSpoolId();
  const file = path.join(directory, `${id}.json`);
  const tmp = path.join(directory, `.${id}.tmp-${process.pid}`);
  const record = { ...entry, id };
  const serialized = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_ENTRY_BYTES) {
    throw codedError(ERR.E_INVALID_INPUT);
  }

  try {
    fs.writeFileSync(tmp, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }

  return record;
}

export function listSpoolEntries(home) {
  const directory = ensureSpoolDirectory(home);
  return fs.readdirSync(directory)
    .filter((file) => ID_PATTERN.test(file.slice(0, -5)) && file.endsWith(".json"))
    .sort()
    .map((file) => {
      const entry = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).some((key) => !STORED_KEYS.has(key))) {
        throw codedError(ERR.E_INVALID_INPUT);
      }
      return entry;
    });
}

export function markSpoolFailure(home, id) {
  const directory = ensureSpoolDirectory(home);
  const file = path.join(directory, `${validId(id)}.json`);
  if (!fs.existsSync(file)) return null;
  const entry = JSON.parse(fs.readFileSync(file, "utf8"));
  const retryCount = Number.isSafeInteger(entry.retry_count) && entry.retry_count >= 0
    ? entry.retry_count + 1
    : 1;
  const next = {
    ...entry,
    retry_count: retryCount,
    ...(retryCount > 3 ? { dead: true } : {}),
  };
  const tmp = path.join(directory, `.${id}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return next;
}

export function removeSpoolEntry(home, id) {
  const directory = ensureSpoolDirectory(home);
  const file = path.join(directory, `${validId(id)}.json`);
  const existed = fs.existsSync(file);
  fs.rmSync(file, { force: true });
  return existed;
}

export function spoolStats(home) {
  const directory = ensureSpoolDirectory(home);
  const files = fs.readdirSync(directory)
    .filter((file) => ID_PATTERN.test(file.slice(0, -5)) && file.endsWith(".json"));
  return {
    count: files.length,
    bytes: files.reduce(
      (total, file) => total + fs.statSync(path.join(directory, file)).size,
      0,
    ),
  };
}
