import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function checkpointFile(home) {
  if (typeof home !== "string" || home.length === 0) {
    throw new TypeError("home is required");
  }
  return path.join(path.resolve(home), "capture", "checkpoints.json");
}

function transcriptKey(transcriptPath) {
  if (typeof transcriptPath !== "string" || transcriptPath.length === 0) {
    throw new TypeError("transcriptPath is required");
  }
  return fs.realpathSync(path.resolve(transcriptPath));
}

function lineHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function tailHashBeforeOffset(file, offset) {
  if (offset === 0) return null;

  const descriptor = fs.openSync(file, "r");
  try {
    const newline = Buffer.allocUnsafe(1);
    if (fs.readSync(descriptor, newline, 0, 1, offset - 1) !== 1
      || newline[0] !== 0x0a) {
      return null;
    }

    const chunkSize = 64 * 1024;
    let cursor = offset - 1;
    let lineStart = 0;

    while (cursor > 0) {
      const length = Math.min(chunkSize, cursor);
      const start = cursor - length;
      const chunk = Buffer.allocUnsafe(length);
      fs.readSync(descriptor, chunk, 0, length, start);
      const previousNewline = chunk.lastIndexOf(0x0a);

      if (previousNewline >= 0) {
        lineStart = start + previousNewline + 1;
        break;
      }
      cursor = start;
    }

    const length = offset - 1 - lineStart;
    const line = Buffer.allocUnsafe(length);
    if (length > 0) fs.readSync(descriptor, line, 0, length, lineStart);
    return lineHash(line);
  } finally {
    fs.closeSync(descriptor);
  }
}

function resetCheckpoint(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    offset: 0,
    tail_hash: null,
    updated_at: null,
  };
}

export function loadCheckpoints(home) {
  const file = checkpointFile(home);
  if (!fs.existsSync(file)) return {};

  const checkpoints = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) {
    throw new Error(`Invalid checkpoint file: ${file}`);
  }
  return checkpoints;
}

export function saveCheckpoints(home, checkpoints) {
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) {
    throw new TypeError("checkpoints must be an object");
  }

  const file = checkpointFile(home);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });

  try {
    fs.writeFileSync(tmp, `${JSON.stringify(checkpoints)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }

  return checkpoints;
}

export function checkpointFor(checkpoints, transcriptPath) {
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) {
    throw new TypeError("checkpoints must be an object");
  }

  const key = transcriptKey(transcriptPath);
  const stat = fs.statSync(key);
  const checkpoint = checkpoints[key];

  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    return resetCheckpoint(stat);
  }

  const offset = checkpoint.offset;
  const invalidOffset = !Number.isSafeInteger(offset) || offset < 0;
  const identityChanged = checkpoint.dev !== stat.dev || checkpoint.ino !== stat.ino;
  const truncated = !invalidOffset && stat.size < offset;

  if (invalidOffset || identityChanged || truncated) return resetCheckpoint(stat);
  if (offset === 0) return resetCheckpoint(stat);

  const actualTailHash = tailHashBeforeOffset(key, offset);
  if (typeof checkpoint.tail_hash !== "string"
    || actualTailHash !== checkpoint.tail_hash) {
    return resetCheckpoint(stat);
  }

  return {
    dev: stat.dev,
    ino: stat.ino,
    offset,
    tail_hash: checkpoint.tail_hash,
    updated_at: typeof checkpoint.updated_at === "string"
      ? checkpoint.updated_at
      : null,
  };
}

export function advanceCheckpoint(
  checkpoints,
  transcriptPath,
  delta,
  at = new Date().toISOString(),
  project = undefined,
) {
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) {
    throw new TypeError("checkpoints must be an object");
  }
  if (!delta || typeof delta !== "object") {
    throw new TypeError("delta is required");
  }

  const key = transcriptKey(transcriptPath);
  const stat = fs.statSync(key);
  const offset = delta.nextOffset ?? delta.offset;
  const tailHash = delta.tailHash ?? delta.tail_hash ?? null;

  if (!Number.isSafeInteger(offset) || offset < 0 || offset > stat.size) {
    throw new RangeError("Invalid checkpoint offset");
  }
  if (offset > 0 && (typeof tailHash !== "string" || tailHash.length !== 16)) {
    throw new TypeError("tailHash is required for a non-zero offset");
  }

  const checkpoint = {
    dev: stat.dev,
    ino: stat.ino,
    offset,
    tail_hash: offset === 0 ? null : tailHash,
    updated_at: at,
    // project를 함께 저장한다 — 슬러그 역매핑(symlink 별칭에 취약)에 다시 의존하지 않기 위함.
    ...(typeof project === "string" ? { project } : {}),
  };
  checkpoints[key] = checkpoint;
  return checkpoint;
}
