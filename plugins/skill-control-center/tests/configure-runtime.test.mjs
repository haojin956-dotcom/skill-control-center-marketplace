import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configureRuntime } from "../scripts/configure-runtime.mjs";

test("configureRuntime pins MCP and hooks to the current Node executable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-runtime-"));
  try {
    fs.mkdirSync(path.join(root, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({
      mcpServers: { "skill-control-center": { command: "node", args: ["./scripts/server.mjs"] } },
    }));
    fs.writeFileSync(path.join(root, "hooks", "hooks.json"), JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node \"$PLUGIN_ROOT/scripts/hook-handler.mjs\"" }] }] },
    }));

    configureRuntime(root, process.execPath);

    const mcp = JSON.parse(fs.readFileSync(path.join(root, ".mcp.json"), "utf8"));
    const hooks = JSON.parse(fs.readFileSync(path.join(root, "hooks", "hooks.json"), "utf8"));
    assert.equal(mcp.mcpServers["skill-control-center"].command, process.execPath);
    assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, `"${process.execPath}" \"$PLUGIN_ROOT/scripts/hook-handler.mjs\"`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
