#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function quoteCommand(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

export function configureRuntime(pluginRoot, nodePath = process.execPath) {
  const resolvedRoot = path.resolve(pluginRoot);
  const resolvedNode = path.resolve(nodePath);
  const mcpPath = path.join(resolvedRoot, ".mcp.json");
  const hooksPath = path.join(resolvedRoot, "hooks", "hooks.json");

  if (!fs.existsSync(resolvedNode)) throw new Error(`Node executable not found: ${resolvedNode}`);
  if (!fs.existsSync(mcpPath)) throw new Error(`Missing MCP configuration: ${mcpPath}`);
  if (!fs.existsSync(hooksPath)) throw new Error(`Missing hooks configuration: ${hooksPath}`);

  const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  const server = mcp.mcpServers?.["skill-control-center"];
  if (!server) throw new Error("Missing skill-control-center MCP server entry.");
  server.command = resolvedNode;
  fs.writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  for (const groups of Object.values(hooks.hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        if (typeof hook.command === "string" && /^node\s/.test(hook.command)) {
          hook.command = hook.command.replace(/^node/, quoteCommand(resolvedNode));
        }
      }
    }
  }
  fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);

  return { pluginRoot: resolvedRoot, nodePath: resolvedNode, mcpPath, hooksPath };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const pluginRoot = path.resolve(path.dirname(currentFile), "..");
  const result = configureRuntime(pluginRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}
