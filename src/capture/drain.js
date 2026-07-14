import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  advanceCheckpoint,
  checkpointFor,
  loadCheckpoints,
  saveCheckpoints,
} from "./checkpoint.js";
import { isProjectOptedIn, listOptedProjects } from "./consent.js";
import { extractCandidates } from "./extract.js";
import { redactText } from "./redaction.js";
import {
  listSpoolEntries,
  markSpoolFailure,
  removeSpoolEntry,
} from "./spool.js";
import { formatDelta, parseTurns, readDelta, sizeStable } from "./transcript.js";
import { appendCards, listCards } from "../core/review.js";
import { ERR, claimHash, validScope } from "../core/schema.js";
import { Store } from "../core/store.js";

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function claudeProjectDirectory(userHome, projectPath) {
  return path.join(
    userHome,
    ".claude",
    "projects",
    path.resolve(projectPath).split(path.sep).join("-"),
  );
}

function checkpointProject(userHome, transcriptPath, projects) {
  const resolved = path.resolve(transcriptPath);
  for (const project of projects) {
    if (isInside(resolved, claudeProjectDirectory(userHome, project.path))) {
      return project.path;
    }
  }
  return null;
}

function aggregateFindings(target, findings) {
  for (const finding of findings) {
    target.set(finding.kind, (target.get(finding.kind) ?? 0) + finding.count);
  }
}

function extractedCandidates(value) {
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(value?.candidates) ? value.candidates : null;
  if (!candidates || candidates.length > 5 || candidates.some((candidate) => (
    !candidate
    || typeof candidate.claim !== "string"
    || candidate.claim.trim() === ""
    || candidate.claim.length > 280
    || !validScope(candidate.scope)
    || typeof candidate.confidence !== "number"
    || !Number.isFinite(candidate.confidence)
    || candidate.confidence < 0
    || candidate.confidence > 1
  ))) {
    const error = new Error("extractor returned invalid candidates");
    error.code = ERR.E_EXTRACT_FAILED;
    throw error;
  }
  return candidates.map((candidate) => ({
    claim: candidate.claim.trim(),
    scope: candidate.scope,
    confidence: candidate.confidence,
  }));
}

function sessionIdFor(candidate, transcriptPath) {
  const sessionId = candidate.spoolEntries
    .map((entry) => entry.session_id)
    .find((value) => typeof value === "string" && value.length > 0);
  return sessionId ?? path.basename(transcriptPath, path.extname(transcriptPath));
}

export async function drainOnce(home, config = {}, {
  dry = false,
  extractor = extractCandidates,
} = {}) {
  const userHome = path.resolve(config.user_home ?? os.homedir());
  const projectsRoot = path.join(userHome, ".claude", "projects");
  const optedProjects = listOptedProjects(home).filter((project) => project.enabled);
  const spoolEntries = listSpoolEntries(home);
  const checkpoints = loadCheckpoints(home);
  const candidates = new Map();

  for (const entry of spoolEntries) {
    if (entry.dead === true || typeof entry.transcript_path !== "string") continue;
    const key = path.resolve(entry.transcript_path);
    const current = candidates.get(key) ?? {
      transcriptPath: entry.transcript_path,
      project: entry.project,
      spoolEntries: [],
    };
    current.spoolEntries.push(entry);
    candidates.set(key, current);
  }

  for (const [transcriptPath, checkpoint] of Object.entries(checkpoints)) {
    const key = path.resolve(transcriptPath);
    if (candidates.has(key)) continue;
    // checkpoint에 저장된 project가 우선 — 슬러그 역매핑은 symlink 별칭(/var vs /private/var)에 취약하다.
    const project = typeof checkpoint?.project === "string"
      ? checkpoint.project
      : checkpointProject(userHome, transcriptPath, optedProjects);
    if (!project) continue;
    try {
      const updatedAt = Date.parse(checkpoint?.updated_at ?? "");
      if (Number.isFinite(updatedAt) && fs.statSync(transcriptPath).mtimeMs <= updatedAt) continue;
      candidates.set(key, { transcriptPath, project, spoolEntries: [] });
    } catch {
      process.stderr.write(`capture drain: transcript unavailable: ${transcriptPath}\n`);
    }
  }

  const result = {
    sessions: 0,
    turns: 0,
    candidates: 0,
    skipped_duplicates: 0,
    truncated: 0,
    malformed: 0,
    dead: spoolEntries.filter((entry) => entry.dead === true).length,
    redaction_findings: [],
  };
  const findingCounts = new Map();
  const store = dry ? null : new Store(home);

  try {
    for (const candidate of candidates.values()) {
      if (typeof candidate.project !== "string") continue;
      try {
        if (!isProjectOptedIn(home, candidate.project)) continue;

        const transcriptPath = fs.realpathSync(candidate.transcriptPath);
        const realProjectsRoot = fs.realpathSync(projectsRoot);
        if (!isInside(transcriptPath, realProjectsRoot)) {
          process.stderr.write(`capture drain: transcript outside Claude projects: ${transcriptPath}\n`);
          continue;
        }
        // 슬러그 역매핑은 advisory다: Claude가 슬러그를 만든 cwd 문자열이 symlink 별칭
        // (/var vs /private/var 등)일 수 있어 realpath 기반 기대값과 어긋날 수 있다.
        // opt-in(139행)과 projects 루트 경계(143행)가 이미 검증됐으므로 라벨은 spool의 project를 쓴다.
        const expectedProject = checkpointProject(userHome, transcriptPath, optedProjects);
        if (expectedProject === null) {
          process.stderr.write(`capture drain: project binding skipped (slug alias): ${transcriptPath}\n`);
        } else if (expectedProject !== fs.realpathSync(candidate.project)) {
          process.stderr.write(`capture drain: transcript project mismatch: ${transcriptPath}\n`);
          continue;
        }
        if (!await sizeStable(transcriptPath, { intervalMs: 500 })) {
          process.stderr.write(`capture drain: transcript size is not stable: ${transcriptPath}\n`);
          continue;
        }

        const checkpoint = checkpointFor(checkpoints, transcriptPath);
        const delta = readDelta(transcriptPath, checkpoint.offset);
        const turns = parseTurns(delta.lines);
        const redacted = redactText(formatDelta(turns));
        result.sessions += 1;
        result.turns += turns.length;
        result.malformed += delta.malformed;
        aggregateFindings(findingCounts, redacted.findings);

        if (dry) continue;

        let extracted = [];
        if (redacted.text.trim() !== "") {
          const extraction = await extractor(redacted.text, config);
          if (extraction?.truncated === true) result.truncated += 1;
          extracted = extractedCandidates(extraction);
        }

        const activeHashes = new Set(
          store.query({ status: "active" }).map((fact) => fact.claim_hash),
        );
        const pendingHashes = new Set(
          listCards(home)
            .filter((card) => card.type === "capture")
            .map((card) => card.claim_hash ?? claimHash(card.claim)),
        );
        const cards = [];
        for (const item of extracted) {
          const hash = claimHash(item.claim);
          if (activeHashes.has(hash) || pendingHashes.has(hash)) {
            result.skipped_duplicates += 1;
            continue;
          }
          pendingHashes.add(hash);
          cards.push({
            type: "capture",
            pair_id: `cap:${hash}`,
            claim: item.claim,
            claim_hash: hash,
            scope: item.scope,
            confidence: item.confidence,
            session_id: sessionIdFor(candidate, transcriptPath),
            project: fs.realpathSync(candidate.project),
            at: new Date().toISOString(),
            status: "pending",
          });
        }
        const added = appendCards(home, cards);
        result.candidates += added;
        result.skipped_duplicates += cards.length - added;

        advanceCheckpoint(checkpoints, transcriptPath, delta, undefined, fs.realpathSync(candidate.project));
        saveCheckpoints(home, checkpoints);
        for (const entry of candidate.spoolEntries) removeSpoolEntry(home, entry.id);
      } catch (error) {
        process.stderr.write(
          `capture drain: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        for (const entry of candidate.spoolEntries) {
          const marked = markSpoolFailure(home, entry.id);
          if (marked?.dead === true && entry.dead !== true) result.dead += 1;
        }
      }
    }
  } finally {
    store?.close();
  }

  result.redaction_findings = [...findingCounts]
    .map(([kind, count]) => ({ kind, count }));
  return result;
}
