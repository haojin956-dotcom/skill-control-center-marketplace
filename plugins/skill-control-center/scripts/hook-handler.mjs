#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeRunForWorkspace, appendEvent, mutateState, now } from "./state-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_RUN_MARKER = process.env.SKILL_CONTROL_CENTER_FIRST_RUN_MARKER
  || path.join(ROOT, ".first-run-test.json");

let input = "";
for await (const chunk of process.stdin) input += chunk;

let event;
try {
  event = JSON.parse(input || "{}");
} catch {
  process.exit(0);
}

const ownTool = String(event.tool_name || "").includes("skill-control-center");

const outcome = mutateState((state) => {
  const run = activeRunForWorkspace(state, event.cwd);
  const runId = run?.id || null;
  const sessionId = event.session_id || "unknown";
  state.sessions[sessionId] = {
    id: sessionId,
    cwd: event.cwd || "",
    turnId: event.turn_id || null,
    model: event.model || null,
    lastEvent: event.hook_event_name || "unknown",
    updatedAt: now(),
  };
  appendEvent(state, {
    runId,
    sessionId,
    type: "codex_hook",
    hook: event.hook_event_name || "unknown",
    toolName: event.tool_name || null,
    toolUseId: event.tool_use_id || null,
  });

  if (event.hook_event_name === "UserPromptSubmit" && fs.existsSync(FIRST_RUN_MARKER)) {
    try { fs.unlinkSync(FIRST_RUN_MARKER); } catch {}
    return {
      additionalContext: [
        "Skill Control Center has a pending first-run verification requested by its installer.",
        "Before handling the user's request, load skill-control-center:controlled-skill-run and start a controlled run titled 安装验证.",
        "Use exactly three observable steps: verify-runtime, render-panel, and finish-test.",
        "Immediately render the control center after starting the run, complete the three steps with short success messages, set the run to completed, and render it again.",
        "Tell the user the installation test passed, then continue with their request.",
      ].join(" "),
    };
  }

  if (event.hook_event_name === "UserPromptSubmit" && state.settings.autoWrapSkills !== false) {
    const activeRunInstruction = run
      ? `A controlled run (${run.id}) already exists for this workspace; continue it instead of creating a duplicate.`
      : "If this turn activates any domain SKILL.md workflow, also load skill-control-center:controlled-skill-run. Before domain work, call start_skill_run with observable steps and then immediately call render_skill_control_center so the panel appears.";
    return {
      additionalContext: [
        "Skill Control Center automatic wrapping is enabled.",
        activeRunInstruction,
        "Before every instrumented step, use check_skill_run and update its status as required by the controller skill.",
        "Do not wrap the controller skill recursively. Do not start a run when no skill is used, when merely explaining skills, or when the user explicitly asks to run without the panel.",
      ].join(" "),
    };
  }

  if (event.hook_event_name !== "PreToolUse" || ownTool || !run) return {};
  if (run.status === "cancelled") return { decision: `Skill run ${run.id} was cancelled. Do not execute more tools for this run.` };
  if (run.status === "paused") return { decision: `Skill run ${run.id} is paused. Resume it in Skill Control Center before continuing.` };

  const tool = String(event.tool_name || "");
  const blocked =
    (tool === "Bash" && run.options.allow_shell === false) ||
    (["apply_patch", "Edit", "Write"].includes(tool) && run.options.allow_file_edits === false) ||
    ((tool === "Agent" || tool === "spawn_agent") && run.options.allow_subagents === false) ||
    (tool.startsWith("mcp__") && run.options.allow_mcp === false);
  if (!blocked) return {};
  return { decision: `${tool} is disabled for controlled skill run ${run.id}. Change the option in Skill Control Center to continue.` };
});

if (outcome?.decision) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: outcome.decision,
    },
  }));
} else if (outcome?.additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: outcome.additionalContext,
    },
  }));
}
