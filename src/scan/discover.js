import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MAX_SCAN_FILES = 4_000;
export const MAX_SCAN_BYTES = 40 * 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const EXCLUDED_DIRECTORY = /^(node_modules|\.git|\.obsidian|\.trash)$/iu;
const MARKDOWN = /\.(md|markdown)$/iu;
const MARKDOWN_OR_MDC = /\.(md|mdc)$/iu;
const TEXT_MEMORY = /\.(md|markdown|txt)$/iu;

export function scanOs(platform = process.platform) {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "win";
  return "linux";
}

function safeRealpath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

function obsidianConfigPath(home, platform, env) {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  }
  if (platform === "win32") {
    return path.join(
      env.APPDATA || path.join(home, "AppData", "Roaming"),
      "obsidian",
      "obsidian.json",
    );
  }
  return path.join(home, ".config", "obsidian", "obsidian.json");
}

function readVaultPaths(configFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
    if (!parsed?.vaults || typeof parsed.vaults !== "object") return [];
    return Object.values(parsed.vaults)
      .map((vault) => vault?.path)
      .filter((vaultPath) => typeof vaultPath === "string" && vaultPath.length > 0)
      .map((vaultPath) => path.resolve(vaultPath));
  } catch {
    return [];
  }
}

/**
 * Discover and read supported local memory files. This function never writes,
 * renames, deletes, or changes timestamps on scan targets.
 */
export function discover({
  home = os.homedir(),
  cwd = process.cwd(),
  platform = process.platform,
  env = process.env,
} = {}) {
  const docs = [];
  const claimedFiles = new Set();
  let totalBytes = 0;
  let partial = false;
  let stopped = false;

  const addFile = (candidate, tool) => {
    if (stopped) return false;
    let stat;
    try {
      stat = fs.statSync(candidate);
    } catch {
      return true;
    }
    if (!stat.isFile()) return true;
    if (stat.size > MAX_FILE_BYTES) {
      partial = true;
      return true;
    }

    const real = safeRealpath(candidate);
    if (!real || claimedFiles.has(real)) return true;
    if (docs.length >= MAX_SCAN_FILES || totalBytes + stat.size > MAX_SCAN_BYTES) {
      partial = true;
      stopped = true;
      return false;
    }

    let body;
    try {
      body = fs.readFileSync(real, "utf8");
    } catch {
      return true;
    }

    claimedFiles.add(real);
    totalBytes += stat.size;
    docs.push({
      tool,
      path: path.resolve(candidate),
      name: path.basename(candidate),
      size: stat.size,
      modified: stat.mtimeMs,
      body,
    });
    if (docs.length >= MAX_SCAN_FILES || totalBytes >= MAX_SCAN_BYTES) {
      partial = true;
      stopped = true;
    }
    return true;
  };

  const walk = (root, tool, accept = () => true) => {
    const visitedDirectories = new Set();
    const visit = (directory) => {
      if (stopped) return;
      const real = safeRealpath(directory);
      if (!real || visitedDirectories.has(real)) return;
      visitedDirectories.add(real);

      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (stopped) return;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDED_DIRECTORY.test(entry.name)) visit(candidate);
          continue;
        }
        if (entry.isSymbolicLink()) {
          let target;
          try {
            target = fs.statSync(candidate);
          } catch {
            continue;
          }
          if (target.isDirectory()) {
            if (!EXCLUDED_DIRECTORY.test(entry.name)) visit(candidate);
          } else if (target.isFile() && accept(candidate)) {
            addFile(candidate, tool);
          }
          continue;
        }
        if (entry.isFile() && accept(candidate)) addFile(candidate, tool);
      }
    };
    visit(root);
  };

  // Direct, unambiguous files are claimed before broad directory scans.
  const direct = [
    [path.join(home, ".claude", "CLAUDE.md"), "claude-code"],
    [path.join(home, ".codex", "AGENTS.md"), "codex"],
    [path.join(home, "AGENTS.md"), "codex"],
    [path.join(home, ".gemini", "GEMINI.md"), "gemini"],
    [path.join(home, ".windsurfrules"), "windsurf"],
    [path.join(home, ".clinerules"), "cline"],
    [path.join(cwd, "CLAUDE.md"), "project"],
    [path.join(cwd, "AGENTS.md"), "project"],
    [path.join(cwd, ".cursorrules"), "project"],
    [path.join(cwd, "GEMINI.md"), "project"],
    [path.join(cwd, ".windsurfrules"), "project"],
    [path.join(cwd, ".clinerules"), "project"],
    [path.join(cwd, ".github", "copilot-instructions.md"), "copilot"],
  ];
  for (const [file, tool] of direct) addFile(file, tool);

  walk(path.join(home, ".cursor", "rules"), "cursor", (file) => MARKDOWN_OR_MDC.test(file));
  walk(path.join(home, ".windsurf", "rules"), "windsurf", (file) => MARKDOWN_OR_MDC.test(file));
  walk(path.join(cwd, ".cursor", "rules"), "project", (file) => MARKDOWN_OR_MDC.test(file));

  // Claude memories only live below each project's immediate memory folder.
  const claudeProjects = path.join(home, ".claude", "projects");
  let projectEntries = [];
  try {
    projectEntries = fs.readdirSync(claudeProjects, { withFileTypes: true });
  } catch {
    // Missing Claude data is normal.
  }
  for (const entry of projectEntries) {
    if (entry.isDirectory() && !EXCLUDED_DIRECTORY.test(entry.name)) {
      walk(path.join(claudeProjects, entry.name, "memory"), "claude-code", (file) => MARKDOWN.test(file));
    }
  }

  const obsidianConfig = obsidianConfigPath(home, platform, env);
  for (const vault of readVaultPaths(obsidianConfig)) {
    walk(vault, "obsidian", (file) => TEXT_MEMORY.test(file));
  }

  return {
    os: scanOs(platform),
    docs,
    totalBytes,
    partial,
  };
}

export const discoverFiles = discover;
