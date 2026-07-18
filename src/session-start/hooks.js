import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_FILE = fileURLToPath(new URL("../cli.js", import.meta.url));
const MANAGED_MARKER = "session-start-hook";

function quoteCommandPart(value) {
  return /\s/u.test(value)
    ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
    : value;
}

function managedCommand() {
  return `${quoteCommandPart(process.execPath)} ${quoteCommandPart(CLI_FILE)} session-start-hook`;
}

function settingsFile(userHome) {
  if (typeof userHome !== "string" || userHome.length === 0) {
    throw new TypeError("userHome is required");
  }
  return path.join(path.resolve(userHome), ".claude", "settings.json");
}

function readSettings(userHome) {
  const file = settingsFile(userHome);
  if (!fs.existsSync(file)) return { file, exists: false, settings: {} };

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Invalid Claude settings JSON: ${file}`, { cause: error });
  }

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Invalid Claude settings JSON: ${file}`);
  }

  return { file, exists: true, settings };
}

function isManagedCommand(value) {
  return typeof value === "string" && value.includes(MANAGED_MARKER);
}

function countManagedCommands(value) {
  if (isManagedCommand(value)) return 1;
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countManagedCommands(item), 0);
  }
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (count, [key, item]) => count + (key === "command"
      ? Number(isManagedCommand(item))
      : countManagedCommands(item)),
    0,
  );
}

function stripManagedEntry(entry) {
  if (isManagedCommand(entry)) return null;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  if (isManagedCommand(entry.command)) return null;
  if (!Array.isArray(entry.hooks)) return entry;

  const hooks = entry.hooks.filter((hook) => !isManagedCommand(hook?.command));
  if (hooks.length === entry.hooks.length) return entry;
  if (hooks.length === 0) return null;
  return { ...entry, hooks };
}

function withoutManagedHooks(settings) {
  const hooks = settings.hooks;
  if (!hooks || !Array.isArray(hooks.SessionStart)) return settings;

  const entries = hooks.SessionStart
    .map(stripManagedEntry)
    .filter((entry) => entry !== null);

  const nextHooks = { ...hooks };
  if (entries.length === 0) delete nextHooks.SessionStart;
  else nextHooks.SessionStart = entries;

  const next = { ...settings };
  if (Object.keys(nextHooks).length === 0) delete next.hooks;
  else next.hooks = nextHooks;
  return next;
}

function withManagedHook(settings) {
  const clean = withoutManagedHooks(settings);
  const hooks = clean.hooks && typeof clean.hooks === "object"
    ? { ...clean.hooks }
    : {};
  const entries = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];

  entries.push({
    matcher: "",
    hooks: [{
      type: "command",
      command: managedCommand(),
    }],
  });

  hooks.SessionStart = entries;
  return { ...clean, hooks };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeSettings(file, previousExists, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const backup = `${file}.bak`;

  try {
    fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    if (previousExists) {
      fs.rmSync(backup, { force: true });
      fs.copyFileSync(file, backup);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function statusResult(file, settings) {
  const count = countManagedCommands(settings.hooks?.SessionStart ?? []);
  return {
    installed: count > 0,
    count,
    command: managedCommand(),
    file,
  };
}

export function sessionStartHookStatus({ userHome }) {
  const { file, settings } = readSettings(userHome);
  return statusResult(file, settings);
}

export function installSessionStartHook({ userHome }) {
  const { file, exists, settings } = readSettings(userHome);
  const next = withManagedHook(settings);
  const changed = !sameJson(settings, next);

  if (changed) writeSettings(file, exists, next);
  return { ...statusResult(file, next), changed };
}

export function uninstallSessionStartHook({ userHome }) {
  const { file, exists, settings } = readSettings(userHome);
  const next = withoutManagedHooks(settings);
  const changed = !sameJson(settings, next);

  if (changed) writeSettings(file, exists, next);
  return { ...statusResult(file, next), changed };
}
