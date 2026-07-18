// policy.js — security policy constants (prompt injection guard + sensitive file blocklist)
//
// INVARIANT: Text stored via remember() is DATA, never interpreted as instructions.
// No code path in nautli evaluates, executes, or pattern-matches stored claims
// to trigger side effects (deletions, config changes, permission escalation).
// This file defines detection patterns for audit/flagging purposes only.

// Patterns that indicate a claim is actually an instruction/injection attempt (7 patterns).
// Matching claims are STILL STORED (data treatment) but flagged in provenance.
const INJECTION_PATTERNS = [
  // Direct commands targeting the memory system
  /\b(?:delete|remove|erase|purge|forget|clear|wipe|drop)\b.*\b(?:all|every|existing|previous|prior|other)\b.*\b(?:memor|fact|claim|record|knowledge|data)/iu,
  /\b(?:ignore|disregard|override|bypass|skip|disable)\b.*\b(?:previous|prior|above|earlier|existing|all)\b.*\b(?:instruction|rule|guard|policy|constraint|guideline|system)/iu,
  // "You are now X" identity override
  /\byou\s+are\s+now\b/iu,
  // System prompt override attempts (singular and plural)
  /\b(?:system\s*prompt|system\s*message|new\s*instructions?)\s*[:=]/iu,
  // Jailbreak markers
  /\b(?:DAN|do\s+anything\s+now|jailbreak|prompt\s+injection)\b/iu,
  // Role-playing identity override
  /\b(?:act|behave)\s+as\b/iu,
  /\bpretend\s+(?:to\s+be|you\s+are)\b/iu,
];

// File path patterns that should be excluded from capture processing by default.
// These match against file paths referenced in or derived from conversation content.
const SENSITIVE_FILE_PATTERNS = [
  /\.env(?:\.\w+)?$/iu,                      // .env, .env.local, .env.production
  /(?:^|\/)\.env$/iu,                         // bare .env
  /(?:^|\/)credentials\.json$/iu,
  /(?:^|\/)service[-_]?account[-_]?key\.json$/iu,
  /(?:^|\/)\.(?:aws|gcp|azure)\/(?:credentials|config)$/iu,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/iu,   // certificates and keystores
  /(?:^|\/)id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$/iu,  // SSH keys
  /(?:^|\/)\.ssh\/(?:known_hosts|authorized_keys|config)$/iu,
  /(?:^|\/)\.netrc$/iu,
  /(?:^|\/)\.pgpass$/iu,
  /(?:^|\/)token\.json$/iu,
  /(?:^|\/)secrets?\.(?:json|ya?ml|toml)$/iu,
  /(?:^|\/)\.git-credentials$/iu,
  /(?:^|\/)kubeconfig$/iu,
  /(?:^|\/)\.kube\/config$/iu,
  /(?:^|\/)\.docker\/config\.json$/iu,
  /(?:^|\/)\.npmrc$/iu,                       // often contains auth tokens
  /(?:^|\/)\.pypirc$/iu,
];

export function isInjectionLike(text) {
  if (typeof text !== "string") return false;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isSensitiveFilePath(filePath) {
  if (typeof filePath !== "string") return false;
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

export { INJECTION_PATTERNS, SENSITIVE_FILE_PATTERNS };
