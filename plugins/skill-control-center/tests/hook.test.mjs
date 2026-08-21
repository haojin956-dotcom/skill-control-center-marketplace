import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("PreToolUse blocks disabled shell access", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-hook-"));
  process.env.SKILL_CONTROL_CENTER_DATA_DIR = dataDir;
  const { mutateState, now } = await import("../scripts/state-store.mjs");
  mutateState((state) => {
    state.runs.demo = {
      id: "demo", workspace: "/tmp/demo", status: "running", createdAt: now(), updatedAt: now(),
      options: { allow_shell: false, allow_file_edits: true, allow_mcp: true, allow_subagents: true }, steps: [],
    };
  });
  const result = spawnSync(process.execPath, ["scripts/hook-handler.mjs"], {
    cwd: root,
    env: { ...process.env, SKILL_CONTROL_CENTER_DATA_DIR: dataDir },
    input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s1", cwd: "/tmp/demo", tool_name: "Bash" }),
    encoding: "utf8",
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("UserPromptSubmit injects automatic wrapping guidance by default", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-auto-hook-"));
  const result = spawnSync(process.execPath, ["scripts/hook-handler.mjs"], {
    cwd: root,
    env: { ...process.env, SKILL_CONTROL_CENTER_DATA_DIR: dataDir },
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s2", cwd: "/tmp/auto", prompt: "Use a skill" }),
    encoding: "utf8",
  });
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(output.hookSpecificOutput.additionalContext, /automatic wrapping is enabled/i);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("UserPromptSubmit stays silent when automatic wrapping is disabled", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-auto-off-"));
  process.env.SKILL_CONTROL_CENTER_DATA_DIR = dataDir;
  const { mutateState } = await import("../scripts/state-store.mjs");
  mutateState((state) => { state.settings.autoWrapSkills = false; });
  const result = spawnSync(process.execPath, ["scripts/hook-handler.mjs"], {
    cwd: root,
    env: { ...process.env, SKILL_CONTROL_CENTER_DATA_DIR: dataDir },
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s3", cwd: "/tmp/auto-off", prompt: "Use a skill" }),
    encoding: "utf8",
  });
  assert.equal(result.stdout, "");
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("UserPromptSubmit consumes the first-run marker and requests a visual test", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-first-run-data-"));
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-first-run-marker-"));
  const markerPath = path.join(markerDir, "first-run.json");
  fs.writeFileSync(markerPath, JSON.stringify({ pending: true }));
  const result = spawnSync(process.execPath, ["scripts/hook-handler.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      SKILL_CONTROL_CENTER_DATA_DIR: dataDir,
      SKILL_CONTROL_CENTER_FIRST_RUN_MARKER: markerPath,
    },
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s4", cwd: "/tmp/first-run", prompt: "测试" }),
    encoding: "utf8",
  });
  const output = JSON.parse(result.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /first-run verification/i);
  assert.match(output.hookSpecificOutput.additionalContext, /render the control center/i);
  assert.equal(fs.existsSync(markerPath), false);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(markerDir, { recursive: true, force: true });
});
