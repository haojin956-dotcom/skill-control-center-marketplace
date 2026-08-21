---
name: controlled-skill-run
description: Run any activated domain skill or repeatable workflow with visible steps, a live control panel, pending-step controls, tool-class guards, pause/resume, and cancellation. Automatically use alongside another skill when Skill Control Center auto-wrap is enabled; also use when the user asks to visualize, monitor, control, pause, or selectively disable a skill or multi-step task.
---

# Controlled Skill Run

Wrap the requested workflow in Skill Control Center. This skill does not replace domain-specific skills; load and follow the relevant domain skill first, then instrument its meaningful milestones here.

Automatic wrapping is enabled by default by the plugin's `UserPromptSubmit` hook. It applies only when a domain skill is activated. Do not recursively wrap this controller skill, and honor an explicit request to run without the panel. The user can persistently toggle this behavior with `set_auto_wrap_skills` or the switch in the panel.

## Required workflow

1. Convert the workflow into 2–12 meaningful steps. Do not expose private reasoning. Steps describe observable work and outcomes.
2. Mark only genuinely skippable work as `optional: true`. Give every step a stable, short kebab-case `id`.
3. Call `start_skill_run` before doing workflow work. Pass:
   - the domain skill or workflow name as `skillName`;
   - the absolute current working directory as `workspace`;
   - the step list;
   - any useful boolean workflow options.
4. Immediately call `render_skill_control_center` with the returned `runId` so the user can see and control the run.
5. Before every step, call `check_skill_run` with `runId` and `stepId`.
   - If `shouldContinue` is false because the run is paused, stop the turn and tell the user it can be resumed from the panel.
   - If the run is cancelled, do not make further tool calls except Skill Control Center reads.
   - If the step is disabled, mark it `skipped` and move to the next enabled step.
   - The user may disable any pending step from the panel, including a step initially declared as required. Honor that explicit runtime override.
6. Mark a step `running` immediately before starting it. Mark it `completed`, `failed`, or `skipped` immediately after the outcome is known, with a concise result message.
   - A tool call that already started cannot be interrupted by this plugin. User controls apply cooperatively at the next checkpoint.
7. Before using Shell, file edits, other MCP tools, or subagents, respect these run options:
   - `allow_shell`
   - `allow_file_edits`
   - `allow_mcp`
   - `allow_subagents`
   Codex Hooks provide a second enforcement layer for supported tool calls.
8. When all enabled steps finish, call `set_skill_run_status` with `completed`. On unrecoverable failure use `failed`.
9. Refresh the panel with `render_skill_control_center` after the final status update.

## Progress quality

- Report observable milestones, not chain-of-thought.
- Keep messages under 160 characters when practical.
- Never claim cancellation undid work that already completed.
- If a tool was blocked by a control setting, explain which option must be re-enabled.
