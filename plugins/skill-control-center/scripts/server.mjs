#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeRunForWorkspace,
  appendEvent,
  findRun,
  latestRun,
  mutateState,
  newId,
  now,
  readState,
  snapshot,
} from "./state-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_URI = "ui://skill-control-center/dashboard-v7.html";
const UI_MIME = "text/html;profile=mcp-app";
const STATUSES = ["pending", "running", "completed", "failed", "skipped", "cancelled"];
const STEP_TRANSITIONS = {
  pending: new Set(["pending", "running", "skipped", "failed"]),
  running: new Set(["running", "completed", "failed"]),
  skipped: new Set(["skipped", "pending"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  cancelled: new Set(["cancelled"]),
};

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const tools = [
  {
    name: "get_control_center_settings",
    title: "Get Skill Control Center settings",
    description: "Read persistent Skill Control Center settings, including automatic wrapping for skill runs.",
    inputSchema: objectSchema({}),
  },
  {
    name: "set_auto_wrap_skills",
    title: "Toggle automatic skill visualization",
    description: "Enable or disable automatically wrapping domain skill workflows in Skill Control Center.",
    inputSchema: objectSchema({ enabled: { type: "boolean" } }, ["enabled"]),
  },
  {
    name: "start_skill_run",
    title: "Start controlled skill run",
    description: "Create an explicit, controllable skill run. Call this before executing the first workflow step.",
    inputSchema: objectSchema({
      skillName: { type: "string", minLength: 1 },
      title: { type: "string" },
      workspace: { type: "string", description: "Absolute task working directory used to associate Codex hook events." },
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 30,
        items: objectSchema({
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          description: { type: "string" },
          optional: { type: "boolean" },
          enabled: { type: "boolean" },
        }, ["id", "title"]),
      },
      options: {
        type: "object",
        additionalProperties: { type: "boolean" },
        description: "Named workflow switches. True means the option is enabled.",
      },
    }, ["skillName", "steps"]),
  },
  {
    name: "get_skill_run",
    title: "Get controlled skill run",
    description: "Read the authoritative state of a run. Use before starting each step.",
    inputSchema: objectSchema({ runId: { type: "string" } }, ["runId"]),
  },
  {
    name: "list_skill_runs",
    title: "List controlled skill runs",
    description: "List recent controlled skill runs.",
    inputSchema: objectSchema({
      status: { type: "string", enum: ["running", "paused", "completed", "failed", "cancelled"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    }),
  },
  {
    name: "check_skill_run",
    title: "Check whether work should continue",
    description: "Mandatory checkpoint before each step. Returns whether the run and requested step may continue.",
    inputSchema: objectSchema({
      runId: { type: "string" },
      stepId: { type: "string" },
    }, ["runId"]),
  },
  {
    name: "update_skill_step",
    title: "Update skill step",
    description: "Mark a step pending, running, completed, failed, or skipped and attach a concise message.",
    inputSchema: objectSchema({
      runId: { type: "string" },
      stepId: { type: "string" },
      status: { type: "string", enum: STATUSES },
      message: { type: "string" },
    }, ["runId", "stepId", "status"]),
  },
  {
    name: "set_skill_step_enabled",
    title: "Enable or disable a skill step",
    description: "Enable, skip, or restore any step that has not started. Skipped steps are blocked at checkpoint time.",
    inputSchema: objectSchema({
      runId: { type: "string" },
      stepId: { type: "string" },
      enabled: { type: "boolean" },
    }, ["runId", "stepId", "enabled"]),
  },
  {
    name: "set_skill_option",
    title: "Set skill option",
    description: "Toggle a named workflow option. Reserved tool guard keys are allow_shell, allow_file_edits, allow_mcp, and allow_subagents.",
    inputSchema: objectSchema({
      runId: { type: "string" },
      key: { type: "string", minLength: 1 },
      enabled: { type: "boolean" },
    }, ["runId", "key", "enabled"]),
  },
  {
    name: "set_skill_run_status",
    title: "Pause, resume, or finish a skill run",
    description: "Set a run to running, paused, completed, or failed.",
    inputSchema: objectSchema({
      runId: { type: "string" },
      status: { type: "string", enum: ["running", "paused", "completed", "failed"] },
      message: { type: "string" },
    }, ["runId", "status"]),
  },
  {
    name: "cancel_skill_run",
    title: "Cancel a skill run",
    description: "Cancel all future steps in a controlled run. The hook also blocks subsequent supported tool calls for the associated workspace.",
    inputSchema: objectSchema({
      runId: { type: "string" },
      reason: { type: "string" },
    }, ["runId"]),
  },
  {
    name: "render_skill_control_center",
    title: "Open Skill Control Center",
    description: "Render the interactive progress and control panel. Omit runId to show the latest run.",
    inputSchema: objectSchema({ runId: { type: "string" } }),
    _meta: {
      ui: { resourceUri: UI_URI },
      "openai/outputTemplate": UI_URI,
      "openai/toolInvocation/invoking": "Opening control center…",
      "openai/toolInvocation/invoked": "Control center ready.",
    },
  },
];

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function toolResult(data, text) {
  return { structuredContent: data, content: [{ type: "text", text }] };
}

function getStep(run, stepId) {
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Unknown step ${stepId} in run ${run.id}.`);
  return step;
}

function assertStepTransition(step, nextStatus) {
  if (!STEP_TRANSITIONS[step.status]?.has(nextStatus)) {
    throw new Error(`Invalid step transition: ${step.id} cannot move from ${step.status} to ${nextStatus}.`);
  }
}

function finalizeRunIfTerminal(run) {
  if (!["running", "paused"].includes(run.status)) return;
  if (!run.steps.every((step) => ["completed", "failed", "skipped", "cancelled"].includes(step.status))) return;
  run.status = run.steps.some((step) => step.status === "failed") ? "failed" : "completed";
  run.message ||= run.status === "completed" ? "All steps reached a terminal state." : "One or more steps failed.";
  run.completedAt = now();
}

function callTool(name, args = {}) {
  if (name === "get_control_center_settings") {
    const state = readState();
    return toolResult({ settings: state.settings }, "Read Skill Control Center settings.");
  }

  if (name === "set_auto_wrap_skills") {
    const data = mutateState((state) => {
      state.settings.autoWrapSkills = Boolean(args.enabled);
      appendEvent(state, { type: "setting_changed", key: "autoWrapSkills", enabled: state.settings.autoWrapSkills });
      const run = latestRun(state);
      return snapshot(run, state);
    });
    return toolResult(data, `Automatic skill visualization ${args.enabled ? "enabled" : "disabled"}.`);
  }

  if (name === "start_skill_run") {
    const skillName = assertString(args.skillName, "skillName");
    if (!Array.isArray(args.steps) || args.steps.length === 0) throw new Error("steps must contain at least one step.");
    const ids = new Set();
    const steps = args.steps.map((source, index) => {
      const id = assertString(source.id, `steps[${index}].id`);
      if (ids.has(id)) throw new Error(`Duplicate step id: ${id}`);
      ids.add(id);
      return {
        id,
        title: assertString(source.title, `steps[${index}].title`),
        description: typeof source.description === "string" ? source.description : "",
        optional: Boolean(source.optional),
        enabled: source.enabled !== false,
        status: "pending",
        message: "",
        startedAt: null,
        completedAt: null,
      };
    });
    const id = newId();
    const createdAt = now();
    const run = {
      id,
      skillName,
      title: typeof args.title === "string" && args.title.trim() ? args.title.trim() : skillName,
      workspace: typeof args.workspace === "string" ? args.workspace : "",
      status: "running",
      message: "",
      options: {
        allow_shell: true,
        allow_file_edits: true,
        allow_mcp: true,
        allow_subagents: true,
        ...(args.options && typeof args.options === "object" ? args.options : {}),
      },
      steps,
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
    };
    const data = mutateState((state) => {
      const existing = activeRunForWorkspace(state, run.workspace);
      if (existing) throw new Error(`Active run ${existing.id} already exists for workspace ${run.workspace}.`);
      state.runs[id] = run;
      appendEvent(state, { runId: id, type: "run_started", message: `Started ${run.title}` });
      return snapshot(run, state);
    });
    return toolResult(data, `Started controlled skill run ${id} with ${steps.length} steps.`);
  }

  if (name === "get_skill_run") {
    const state = readState();
    const run = findRun(state, assertString(args.runId, "runId"));
    return toolResult(snapshot(run, state), `Run ${run.id} is ${run.status}.`);
  }

  if (name === "list_skill_runs") {
    const state = readState();
    const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 50) : 10;
    const runs = Object.values(state.runs)
      .filter((run) => !args.status || run.status === args.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return toolResult({ runs }, `Found ${runs.length} controlled skill runs.`);
  }

  if (name === "check_skill_run") {
    const state = readState();
    const run = findRun(state, assertString(args.runId, "runId"));
    const step = args.stepId ? getStep(run, args.stepId) : null;
    const stepEnabled = step ? step.enabled !== false : true;
    const shouldContinue = run.status === "running" && stepEnabled;
    const reason = run.status !== "running"
      ? `Run is ${run.status}.`
      : stepEnabled ? "Run and step are enabled." : "Step was disabled by the user.";
    return toolResult({ shouldContinue, reason, run: snapshot(run, state).run, step }, reason);
  }

  if (name === "update_skill_step") {
    if (!STATUSES.includes(args.status)) throw new Error(`Invalid step status: ${args.status}`);
    const data = mutateState((state) => {
      const run = findRun(state, assertString(args.runId, "runId"));
      if (["cancelled", "completed"].includes(run.status)) throw new Error(`Run ${run.id} is already ${run.status}.`);
      const step = getStep(run, assertString(args.stepId, "stepId"));
      assertStepTransition(step, args.status);
      step.status = args.status;
      step.message = typeof args.message === "string" ? args.message : step.message;
      if (args.status === "running" && !step.startedAt) step.startedAt = now();
      if (["completed", "failed", "skipped"].includes(args.status)) step.completedAt = now();
      run.updatedAt = now();
      appendEvent(state, { runId: run.id, type: "step_updated", stepId: step.id, status: step.status, message: step.message });
      finalizeRunIfTerminal(run);
      return snapshot(run, state);
    });
    return toolResult(data, `Step ${args.stepId} is now ${args.status}.`);
  }

  if (name === "set_skill_step_enabled") {
    const data = mutateState((state) => {
      const run = findRun(state, assertString(args.runId, "runId"));
      if (!["running", "paused"].includes(run.status)) throw new Error(`Run ${run.id} is ${run.status} and cannot be edited.`);
      const step = getStep(run, assertString(args.stepId, "stepId"));
      if (step.status !== "pending" && step.status !== "skipped") throw new Error(`Step ${step.id} has already started.`);
      if (args.enabled) {
        const index = run.steps.indexOf(step);
        const laterStarted = run.steps.slice(index + 1).some((item) => !["pending", "skipped"].includes(item.status));
        if (laterStarted) throw new Error(`Step ${step.id} cannot be restored after a later step has started.`);
      }
      step.enabled = Boolean(args.enabled);
      step.status = step.enabled ? "pending" : "skipped";
      step.message = step.enabled ? "Restored by user." : "Skipped by user.";
      step.completedAt = step.enabled ? null : now();
      run.updatedAt = now();
      appendEvent(state, { runId: run.id, type: "step_toggled", stepId: step.id, enabled: step.enabled });
      finalizeRunIfTerminal(run);
      return snapshot(run, state);
    });
    return toolResult(data, `Step ${args.stepId} ${args.enabled ? "restored" : "skipped"}.`);
  }

  if (name === "set_skill_option") {
    const key = assertString(args.key, "key");
    const data = mutateState((state) => {
      const run = findRun(state, assertString(args.runId, "runId"));
      run.options[key] = Boolean(args.enabled);
      run.updatedAt = now();
      appendEvent(state, { runId: run.id, type: "option_changed", key, enabled: run.options[key] });
      return snapshot(run, state);
    });
    return toolResult(data, `Option ${key} ${args.enabled ? "enabled" : "disabled"}.`);
  }

  if (name === "set_skill_run_status") {
    const allowed = ["running", "paused", "completed", "failed"];
    if (!allowed.includes(args.status)) throw new Error(`Invalid run status: ${args.status}`);
    const data = mutateState((state) => {
      const run = findRun(state, assertString(args.runId, "runId"));
      if (run.status === "cancelled") throw new Error("A cancelled run cannot be resumed.");
      run.status = args.status;
      run.message = typeof args.message === "string" ? args.message : run.message;
      run.updatedAt = now();
      if (["completed", "failed"].includes(args.status)) run.completedAt = now();
      appendEvent(state, { runId: run.id, type: "run_status", status: run.status, message: run.message });
      return snapshot(run, state);
    });
    return toolResult(data, `Run ${args.runId} is now ${args.status}.`);
  }

  if (name === "cancel_skill_run") {
    const data = mutateState((state) => {
      const run = findRun(state, assertString(args.runId, "runId"));
      run.status = "cancelled";
      run.message = typeof args.reason === "string" ? args.reason : "Cancelled by user.";
      run.updatedAt = now();
      run.completedAt = now();
      for (const step of run.steps) {
        if (step.status === "pending") {
          step.enabled = false;
          step.status = "cancelled";
          step.message = "Cancelled with run.";
          step.completedAt = now();
        }
      }
      appendEvent(state, { runId: run.id, type: "run_cancelled", message: run.message });
      return snapshot(run, state);
    });
    return toolResult(data, `Cancelled run ${args.runId}. No future steps should execute.`);
  }

  if (name === "render_skill_control_center") {
    const state = readState();
    const run = args.runId ? findRun(state, args.runId) : latestRun(state);
    return toolResult(snapshot(run, state), run ? `Showing control center for ${run.id}.` : "No controlled runs exist yet.");
  }

  throw new Error(`Unknown tool: ${name}`);
}

function resourceContents() {
  return {
    contents: [{
      uri: UI_URI,
      mimeType: UI_MIME,
      text: fs.readFileSync(path.join(ROOT, "assets", "control-center.html"), "utf8"),
      _meta: { ui: { prefersBorder: true } },
    }],
  };
}

async function handle(message) {
  const { id, method, params = {} } = message;
  if (method === "notifications/initialized") return null;
  if (method === "initialize") {
    return { id, result: {
      protocolVersion: params.protocolVersion || "2025-06-18",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "skill-control-center", version: "0.2.0" },
    } };
  }
  if (method === "ping") return { id, result: {} };
  if (method === "tools/list") return { id, result: { tools } };
  if (method === "resources/list") {
    return { id, result: { resources: [{ uri: UI_URI, name: "Skill Control Center", mimeType: UI_MIME }] } };
  }
  if (method === "resources/templates/list") return { id, result: { resourceTemplates: [] } };
  if (method === "resources/read") {
    if (params.uri !== UI_URI) throw new Error(`Unknown resource: ${params.uri}`);
    return { id, result: resourceContents() };
  }
  if (method === "tools/call") return { id, result: callTool(params.name, params.arguments || {}) };
  if (id === undefined) return null;
  return { id, error: { code: -32601, message: `Method not found: ${method}` } };
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const raw = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!raw) continue;
    Promise.resolve()
      .then(() => handle(JSON.parse(raw)))
      .then((response) => {
        if (response) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...response })}\n`);
      })
      .catch((error) => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch {}
        if (parsed?.id !== undefined) {
          process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: -32603, message: error.message } })}\n`);
        }
      });
  }
});
