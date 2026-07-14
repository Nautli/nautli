import { createHash } from "node:crypto";
import fs from "node:fs";

const HARNESS_PREFIXES = Object.freeze([
  "<system-reminder>",
  "[SYSTEM NOTIFICATION",
  "<task-notification>",
  "<command-name>",
]);

function lineHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function parseCompletedLines(buffer) {
  const lines = [];
  let malformed = 0;
  let start = 0;

  while (start < buffer.length) {
    const newline = buffer.indexOf(0x0a, start);
    if (newline < 0) break;

    let line = buffer.subarray(start, newline);
    if (line.length > 0 && line[line.length - 1] === 0x0d) {
      line = line.subarray(0, line.length - 1);
    }

    try {
      lines.push(JSON.parse(line.toString("utf8")));
    } catch {
      malformed += 1;
    }
    start = newline + 1;
  }

  return { lines, malformed };
}

export function readDelta(file, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative safe integer");
  }

  const stat = fs.statSync(file);
  if (offset > stat.size) throw new RangeError("offset is beyond the end of the file");

  const length = stat.size - offset;
  if (length === 0) {
    return {
      lines: [],
      nextOffset: offset,
      tailHash: null,
      malformed: 0,
    };
  }

  const descriptor = fs.openSync(file, "r");
  let buffer;
  try {
    buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const count = fs.readSync(descriptor, buffer, read, length - read, offset + read);
      if (count === 0) break;
      read += count;
    }
    buffer = buffer.subarray(0, read);
  } finally {
    fs.closeSync(descriptor);
  }

  const finalNewline = buffer.lastIndexOf(0x0a);
  if (finalNewline < 0) {
    return {
      lines: [],
      nextOffset: offset,
      tailHash: null,
      malformed: 0,
    };
  }

  const complete = buffer.subarray(0, finalNewline + 1);
  const previousNewline = complete.lastIndexOf(0x0a, finalNewline - 1);
  const tail = complete.subarray(previousNewline + 1, finalNewline);
  const { lines, malformed } = parseCompletedLines(complete);

  return {
    lines,
    nextOffset: offset + complete.length,
    tailHash: lineHash(tail),
    malformed,
  };
}

function turnText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      if (!block || typeof block !== "object") return [];
      if (block.type !== "text" || typeof block.text !== "string") return [];
      return [block.text];
    })
    .join("\n");
}

function isHarnessNoise(text) {
  const normalized = text.trimStart();
  return HARNESS_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function parseTurns(lines) {
  if (!Array.isArray(lines)) throw new TypeError("lines must be an array");

  const turns = [];
  for (const record of lines) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    if (record.type !== "user" && record.type !== "assistant") continue;
    if (record.isMeta === true || record.message?.isMeta === true) continue;

    const role = record.type;
    const message = record.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    if (message.role !== undefined && message.role !== role) continue;

    const text = turnText(message.content);
    if (text.trim() === "") continue;
    if (role === "user" && isHarnessNoise(text)) continue;

    turns.push({ role, text });
  }
  return turns;
}

export function formatDelta(turns) {
  if (!Array.isArray(turns)) throw new TypeError("turns must be an array");

  return turns
    .filter((turn) => turn?.role === "user" || turn?.role === "assistant")
    .map((turn) => `${turn.role === "user" ? "유저" : "AI"}: ${String(turn.text ?? "")}`)
    .join("\n");
}

export async function sizeStable(file, { intervalMs = 500 } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError("intervalMs must be a non-negative number");
  }

  const first = fs.statSync(file);
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  const second = fs.statSync(file);
  return first.size === second.size;
}
