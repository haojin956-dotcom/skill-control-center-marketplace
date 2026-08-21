import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function client() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-mcp-"));
  const child = spawn(process.execPath, ["scripts/server.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, SKILL_CONTROL_CENTER_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const waiters = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      waiters.get(message.id)?.(message);
      waiters.delete(message.id);
    }
  });
  let id = 0;
  function request(method, params = {}) {
    const requestId = ++id;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out: ${method}`)), 3000);
      waiters.set(requestId, (message) => { clearTimeout(timer); resolve(message); });
    });
  }
  return { child, dataDir, request };
}

test("MCP server exposes tools and enforces run controls", async () => {
  const api = client();
  try {
    const initialized = await api.request("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "test", version: "1" } });
    assert.equal(initialized.result.serverInfo.name, "skill-control-center");
    const listed = await api.request("tools/list");
    assert.ok(listed.result.tools.some((tool) => tool.name === "render_skill_control_center"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "set_auto_wrap_skills"));

    const settings = await api.request("tools/call", { name: "get_control_center_settings", arguments: {} });
    assert.equal(settings.result.structuredContent.settings.autoWrapSkills, true);
    const autoOff = await api.request("tools/call", { name: "set_auto_wrap_skills", arguments: { enabled: false } });
    assert.equal(autoOff.result.structuredContent.settings.autoWrapSkills, false);

    const started = await api.request("tools/call", { name: "start_skill_run", arguments: {
      skillName: "test-skill",
      workspace: "/tmp/test-workspace",
      steps: [
        { id: "required", title: "Required" },
        { id: "optional", title: "Optional", optional: true },
      ],
    } });
    const runId = started.result.structuredContent.run.id;
    const duplicate = await api.request("tools/call", { name: "start_skill_run", arguments: {
      skillName: "duplicate",
      workspace: "/tmp/test-workspace",
      steps: [{ id: "duplicate", title: "Duplicate" }],
    } });
    assert.match(duplicate.error.message, /Active run .* already exists/);
    const requiredSkipped = await api.request("tools/call", { name: "set_skill_step_enabled", arguments: { runId, stepId: "required", enabled: false } });
    assert.equal(requiredSkipped.result.structuredContent.run.steps[0].status, "skipped");
    const requiredRestored = await api.request("tools/call", { name: "set_skill_step_enabled", arguments: { runId, stepId: "required", enabled: true } });
    assert.equal(requiredRestored.result.structuredContent.run.steps[0].status, "pending");
    const disabled = await api.request("tools/call", { name: "set_skill_step_enabled", arguments: { runId, stepId: "optional", enabled: false } });
    assert.equal(disabled.result.structuredContent.run.steps[1].status, "skipped");
    const checked = await api.request("tools/call", { name: "check_skill_run", arguments: { runId, stepId: "optional" } });
    assert.equal(checked.result.structuredContent.shouldContinue, false);
    await api.request("tools/call", { name: "update_skill_step", arguments: { runId, stepId: "required", status: "running" } });
    const invalidTransition = await api.request("tools/call", { name: "update_skill_step", arguments: { runId, stepId: "required", status: "pending" } });
    assert.match(invalidTransition.error.message, /Invalid step transition/);
    const completed = await api.request("tools/call", { name: "update_skill_step", arguments: { runId, stepId: "required", status: "completed" } });
    assert.equal(completed.result.structuredContent.run.status, "completed");
    assert.ok(completed.result.structuredContent.run.completedAt);

    const cancellable = await api.request("tools/call", { name: "start_skill_run", arguments: {
      skillName: "cancel-test",
      workspace: "/tmp/cancel-workspace",
      steps: [{ id: "active", title: "Active" }, { id: "future", title: "Future" }],
    } });
    const cancelRunId = cancellable.result.structuredContent.run.id;
    await api.request("tools/call", { name: "update_skill_step", arguments: { runId: cancelRunId, stepId: "active", status: "running" } });
    const cancelled = await api.request("tools/call", { name: "cancel_skill_run", arguments: { runId: cancelRunId } });
    assert.equal(cancelled.result.structuredContent.run.status, "cancelled");
    assert.equal(cancelled.result.structuredContent.run.steps[0].status, "running");
    assert.equal(cancelled.result.structuredContent.run.steps[1].status, "cancelled");
    assert.equal(cancelled.result.structuredContent.run.steps[1].enabled, false);
    assert.equal(cancelled.result.structuredContent.run.steps[1].message, "Cancelled with run.");

    const resource = await api.request("resources/read", { uri: "ui://skill-control-center/dashboard-v7.html" });
    assert.match(resource.result.contents[0].text, /Skill Control Center/);
    assert.match(resource.result.contents[0].text, /button\.dataset\.stepAction === "restore"/);
    assert.match(resource.result.contents[0].text, /操作失败，请重试/);
    assert.match(resource.result.contents[0].text, /<details class="settings-menu"/);
    assert.match(resource.result.contents[0].text, /更多设置/);
    assert.match(resource.result.contents[0].text, /refresh\(\{ silent: true \}\)/);
    assert.match(resource.result.contents[0].text, /if \(!silent\) notify/);
  } finally {
    api.child.kill();
    fs.rmSync(api.dataDir, { recursive: true, force: true });
  }
});
