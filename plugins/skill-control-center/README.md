# Skill Control Center

Skill Control Center is a local Codex plugin MVP for observable, controllable skill runs. It adds an instrumented wrapper skill, a dependency-free MCP server, an MCP Apps control panel, and Codex lifecycle hooks.

## What works

- Explicit progress steps with pending/running/completed/failed/skipped states
- Interactive MCP Apps dashboard rendered beside the conversation on compatible hosts
- Skip or restore any step that has not started
- Immediate button feedback, busy states, and accessible result announcements
- Strict step-state transitions and automatic run completion
- Distinct cancelled step state for future work removed by run cancellation
- One active run per workspace
- Named workflow options
- Pause/resume and cooperative cancellation
- Hook-enforced switches for Shell, file edits, other MCP tools, and subagents
- Local durable state in Codex's plugin data directory
- Hook event history associated with the active run by workspace
- Automatic wrapping for domain skills, enabled by default and configurable from the panel

Cancellation stops future instrumented steps and blocks subsequent supported local tool calls. It marks untouched future steps as cancelled, but it does not interrupt a tool call that has already started or undo completed side effects. True host Turn interruption requires a separate Codex App Server client because a plugin MCP server does not own the host's App Server connection.

## Project layout

```text
.codex-plugin/plugin.json
.mcp.json
skills/controlled-skill-run/SKILL.md
hooks/hooks.json
scripts/server.mjs
scripts/state-store.mjs
scripts/hook-handler.mjs
assets/control-center.html
tests/*.test.mjs
```

## Verify locally

Requires Node.js 20 or newer.

```bash
npm test
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
```

## Install for development

The source tree is intentionally not added to a marketplace automatically. After review, either copy it into a personal marketplace plugin directory or use `$plugin-creator` to generate/update the personal marketplace entry. Refresh Codex, install the plugin, then review and trust its bundled hooks with `/hooks`.

Start a new task and invoke any domain skill; the control panel should open automatically. You can also ask explicitly:

```text
$controlled-skill-run Run the repository checks with a live control panel. Make documentation optional.
```

The automatic mode uses a `UserPromptSubmit` hook to add a developer instruction whenever a turn begins. If the turn activates a domain skill, Codex loads the wrapper, starts a controlled run, and renders the MCP Apps panel. The host currently has no `SkillStart` hook, so this remains model-mediated rather than a host-level interception. The wrapper must call `check_skill_run` before every step; arbitrary private model reasoning cannot be visualized.
