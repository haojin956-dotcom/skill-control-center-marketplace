import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const sleepArray = new Int32Array(new SharedArrayBuffer(4));

export function dataDirectory() {
  return (
    process.env.SKILL_CONTROL_CENTER_DATA_DIR ||
    process.env.PLUGIN_DATA ||
    process.env.CLAUDE_PLUGIN_DATA ||
    path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skill-control-center")
  );
}

export function statePath() {
  return path.join(dataDirectory(), "state.json");
}

function emptyState() {
  return {
    version: 2,
    settings: {
      autoWrapSkills: true,
    },
    runs: {},
    sessions: {},
    events: [],
  };
}

function ensureShape(value) {
  const base = emptyState();
  if (!value || typeof value !== "object") return base;
  return {
    version: 2,
    settings: {
      ...base.settings,
      ...(value.settings && typeof value.settings === "object" ? value.settings : {}),
    },
    runs: value.runs && typeof value.runs === "object" ? value.runs : {},
    sessions: value.sessions && typeof value.sessions === "object" ? value.sessions : {},
    events: Array.isArray(value.events) ? value.events : [],
  };
}

export function readState() {
  try {
    return ensureShape(JSON.parse(fs.readFileSync(statePath(), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 10_000) fs.unlinkSync(lockPath);
      } catch {}
      Atomics.wait(sleepArray, 0, 0, 10);
    }
  }
  throw new Error("Timed out waiting for the Skill Control Center state lock.");
}

export function mutateState(mutator) {
  const file = statePath();
  const lock = `${file}.lock`;
  const handle = acquireLock(lock);
  try {
    const state = readState();
    const result = mutator(state);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
    return result;
  } finally {
    fs.closeSync(handle);
    try { fs.unlinkSync(lock); } catch {}
  }
}

export function now() {
  return new Date().toISOString();
}

export function newId(prefix = "run") {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function findRun(state, runId) {
  const run = state.runs[runId];
  if (!run) throw new Error(`Unknown run: ${runId}`);
  return run;
}

export function activeRunForWorkspace(state, workspace) {
  if (!workspace) return null;
  return Object.values(state.runs)
    .filter((run) => run.workspace === workspace && ["running", "paused"].includes(run.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

export function latestRun(state) {
  return Object.values(state.runs)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

export function appendEvent(state, event) {
  state.events.push({ id: newId("evt"), at: now(), ...event });
  if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
}

export function snapshot(run, state) {
  if (!run) return { run: null, settings: state.settings, recentEvents: [] };
  const complete = run.steps.filter((step) => ["completed", "skipped", "cancelled"].includes(step.status)).length;
  return {
    run,
    settings: state.settings,
    progress: {
      complete,
      total: run.steps.length,
      percent: run.steps.length ? Math.round((complete / run.steps.length) * 100) : 0,
    },
    recentEvents: state.events.filter((event) => event.runId === run.id).slice(-30),
  };
}
