#!/bin/bash
set -euo pipefail

REPOSITORY="https://github.com/haojin956-dotcom/skill-control-center-marketplace.git"
MARKETPLACE_NAME="skill-control-center-marketplace"
PLUGIN_SELECTOR="skill-control-center@${MARKETPLACE_NAME}"
INSTALL_PARENT="${HOME}/Library/Application Support/Skill Control Center"
INSTALL_DIR="${INSTALL_PARENT}/marketplace"

log() {
  printf '\n[%s] %s\n' "Skill Control Center" "$1"
}

find_codex() {
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return
  fi
  local bundled="/Applications/ChatGPT.app/Contents/Resources/codex"
  if [ -x "$bundled" ]; then
    printf '%s\n' "$bundled"
    return
  fi
  return 1
}

node_is_compatible() {
  local candidate="$1"
  [ -x "$candidate" ] || return 1
  local major
  major="$($candidate -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  [ -n "$major" ] && [ "$major" -ge 20 ]
}

find_node() {
  local candidates=()
  if command -v node >/dev/null 2>&1; then
    candidates+=("$(command -v node)")
  fi
  candidates+=(
    "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "${HOME}/.volta/bin/node"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if node_is_compatible "$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 1
}

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'This installer currently supports macOS only.\n' >&2
  exit 2
fi

CODEX_BIN="$(find_codex || true)"
NODE_BIN="$(find_node || true)"

if [ -z "$CODEX_BIN" ]; then
  printf 'Codex CLI was not found. Install or update the ChatGPT desktop app first.\n' >&2
  exit 3
fi
if [ -z "$NODE_BIN" ]; then
  printf 'Node.js 20+ was not found. Update the ChatGPT desktop app or install Node.js 20+, then run this installer again.\n' >&2
  exit 4
fi
if ! command -v git >/dev/null 2>&1; then
  printf 'Git was not found. Install the Xcode Command Line Tools, then run this installer again.\n' >&2
  exit 5
fi

log "Using Node: ${NODE_BIN}"
mkdir -p "$INSTALL_PARENT"

if [ -e "$INSTALL_DIR" ]; then
  BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S)"
  mv "$INSTALL_DIR" "$BACKUP_DIR"
  log "Moved the previous installation to ${BACKUP_DIR}"
fi
log "Downloading the marketplace"
git clone --depth 1 --branch main "$REPOSITORY" "$INSTALL_DIR"

PLUGIN_ROOT="${INSTALL_DIR}/plugins/skill-control-center"
log "Pinning MCP and hooks to the working Node runtime"
if [ -f "${PLUGIN_ROOT}/scripts/configure-runtime.mjs" ]; then
  "$NODE_BIN" "${PLUGIN_ROOT}/scripts/configure-runtime.mjs"
else
  "$NODE_BIN" --input-type=module - "$PLUGIN_ROOT" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const pluginRoot = path.resolve(process.argv[2]);
const nodePath = process.execPath;
const mcpPath = path.join(pluginRoot, ".mcp.json");
const hooksPath = path.join(pluginRoot, "hooks", "hooks.json");
const quoteCommand = (value) => `"${String(value).replaceAll('"', '\\"')}"`;

const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
mcp.mcpServers["skill-control-center"].command = nodePath;
fs.writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
for (const groups of Object.values(hooks.hooks || {})) {
  for (const group of groups || []) {
    for (const hook of group.hooks || []) {
      if (typeof hook.command === "string" && /^node\s/.test(hook.command)) {
        hook.command = hook.command.replace(/^node/, quoteCommand(nodePath));
      }
    }
  }
}
fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
NODE
fi

log "Registering the local marketplace"
"$CODEX_BIN" plugin marketplace remove "$MARKETPLACE_NAME" >/dev/null 2>&1 || true
"$CODEX_BIN" plugin marketplace add "$INSTALL_DIR" --json

log "Installing the plugin"
"$CODEX_BIN" plugin add "$PLUGIN_SELECTOR" --json

log "Verifying plugin and MCP registration"
PLUGIN_JSON="$("$CODEX_BIN" plugin list --json)"
MCP_JSON="$("$CODEX_BIN" mcp list --json)"
printf '%s' "$PLUGIN_JSON" | grep -F '"name": "skill-control-center"' >/dev/null
printf '%s' "$MCP_JSON" | grep -F '"name": "skill-control-center"' >/dev/null
printf '%s' "$MCP_JSON" | grep -F "\"command\": \"${NODE_BIN}\"" >/dev/null

MCP_ROOT="$(printf '%s' "$MCP_JSON" | "$NODE_BIN" --input-type=module -e '
let input = "";
for await (const chunk of process.stdin) input += chunk;
const servers = JSON.parse(input);
const server = servers.find((item) => item.name === "skill-control-center");
if (!server?.transport?.cwd) process.exit(1);
process.stdout.write(server.transport.cwd.replace(/\/\.$/, ""));
')"
printf '{"pending":true,"createdBy":"install-macos.sh"}\n' > "${MCP_ROOT}/.first-run-test.json"

log "Installation verified"
printf 'Completely quit ChatGPT/Codex and reopen it. Your first message in a new task will automatically run a visual three-step installation test.\n'
