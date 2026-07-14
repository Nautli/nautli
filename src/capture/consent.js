import fs from "node:fs";
import path from "node:path";
import { ERR } from "../core/schema.js";

function codedError(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function configFile(home) {
  if (typeof home !== "string" || home.length === 0) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  return path.join(path.resolve(home), "config.json");
}

function readConfig(home) {
  const file = configFile(home);
  if (!fs.existsSync(file)) return {};
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  return config;
}

function writeConfig(home, config) {
  const file = configFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(config)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

function realProjectPath(projectPath) {
  if (typeof projectPath !== "string" || projectPath.length === 0) {
    throw codedError(ERR.E_INVALID_INPUT);
  }
  try {
    return fs.realpathSync(path.resolve(projectPath));
  } catch (error) {
    throw codedError(ERR.E_INVALID_INPUT, error);
  }
}

function captureProjects(config) {
  const projects = config.capture_projects;
  return projects && typeof projects === "object" && !Array.isArray(projects)
    ? projects
    : {};
}

export function isProjectOptedIn(home, projectPath) {
  const project = captureProjects(readConfig(home))[realProjectPath(projectPath)];
  return project?.enabled === true;
}

export function setProjectOptIn(home, projectPath, enabled) {
  if (typeof enabled !== "boolean") throw codedError(ERR.E_INVALID_INPUT);
  const realpath = realProjectPath(projectPath);
  const config = readConfig(home);
  const projects = { ...captureProjects(config) };
  const previous = projects[realpath];
  const now = new Date().toISOString();

  projects[realpath] = {
    enabled,
    opted_at: enabled
      ? now
      : typeof previous?.opted_at === "string"
        ? previous.opted_at
        : now,
  };
  writeConfig(home, { ...config, capture_projects: projects });
  return { path: realpath, ...projects[realpath] };
}

export function listOptedProjects(home) {
  return Object.entries(captureProjects(readConfig(home)))
    .map(([projectPath, value]) => ({
      path: projectPath,
      enabled: value?.enabled === true,
      opted_at: typeof value?.opted_at === "string" ? value.opted_at : null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
