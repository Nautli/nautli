const KIND_ORDER = Object.freeze([
  "private-key",
  "aws-key",
  "github-token",
  "slack-token",
  "bearer",
  "assignment",
  "high-entropy",
]);

function token(kind) {
  return `«redacted:${kind}»`;
}

export function shannonEntropy(value) {
  if (typeof value !== "string" || value.length === 0) return 0;
  const counts = new Map();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function urlRanges(text) {
  const ranges = [];
  const pattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/giu;
  for (const match of text.matchAll(pattern)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function surroundingToken(text, start, end) {
  const tokenStart = Math.max(
    text.lastIndexOf(" ", start - 1),
    text.lastIndexOf("\n", start - 1),
    text.lastIndexOf("\t", start - 1),
  ) + 1;
  const whitespace = text.slice(end).search(/\s/u);
  const tokenEnd = whitespace < 0 ? text.length : end + whitespace;
  return text.slice(tokenStart, tokenEnd);
}

function isUrlPath(text, start, end, ranges, surrounding) {
  if (ranges.some(([from, to]) => start < to && end > from)) return true;
  return /^(?:\.{0,2}\/|\\)/u.test(surrounding)
    || text[start - 1] === "/"
    || text[start - 1] === "\\";
}

function redact(text) {
  const counts = new Map();
  const mark = (kind) => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return token(kind);
  };
  let output = text;

  output = output.replace(
    /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/giu,
    () => mark("private-key"),
  );
  output = output.replace(
    /(?<![0-9A-Z])AKIA[0-9A-Z]{16}(?![0-9A-Z])/giu,
    () => mark("aws-key"),
  );
  output = output.replace(
    /(?<![A-Za-z0-9_])(?:gh[pso]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)(?![A-Za-z0-9_])/gu,
    () => mark("github-token"),
  );
  output = output.replace(
    /(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]+(?![A-Za-z0-9-])/giu,
    () => mark("slack-token"),
  );
  output = output.replace(
    /(\bAuthorization\s*:\s*Bearer\s+|\bBearer\s+)("(?:[^"\\]|\\.)*"|[A-Za-z0-9._~+/=-]+)/giu,
    (match, prefix, secret) => secret.startsWith("«redacted:")
      ? match
      : `${prefix}${mark("bearer")}`,
  );
  output = output.replace(
    /(\b(?:api[\s_-]*key|secret|token|passwd|password)\b\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&)\]}"']+)/giu,
    (match, prefix, secret) => {
      if (!secret || secret.startsWith("«redacted:")) return match;
      return `${prefix}${mark("assignment")}`;
    },
  );

  const ranges = urlRanges(output);
  output = output.replace(
    /(?<![\p{L}\p{N}+/_=-])(?:[A-Fa-f0-9]{24,}|[A-Za-z0-9+/_-]{24,}={0,2})(?![\p{L}\p{N}+/_=-])/gu,
    (candidate, offset) => {
      const end = offset + candidate.length;
      const surrounding = surroundingToken(output, offset, end);
      if (/\p{Script=Hangul}/u.test(surrounding)) return candidate;
      if (isUrlPath(output, offset, end, ranges, surrounding)) return candidate;
      const threshold = candidate.length >= 28 ? 3.85 : 4;
      return shannonEntropy(candidate) >= threshold ? mark("high-entropy") : candidate;
    },
  );

  return {
    text: output,
    findings: KIND_ORDER
      .filter((kind) => counts.has(kind))
      .map((kind) => ({ kind, count: counts.get(kind) })),
  };
}

export function redactText(text) {
  if (typeof text !== "string") return { text: "", findings: [] };
  return redact(text);
}

export function previewRedaction(text) {
  return redactText(text);
}
