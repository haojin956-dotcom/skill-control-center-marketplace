import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "skill-control-center-test-"));
process.env.SKILL_CONTROL_CENTER_DATA_DIR = temporary;
const store = await import("../scripts/state-store.mjs");

test("state mutations persist atomically", () => {
  store.mutateState((state) => {
    state.runs.demo = { id: "demo", workspace: "/tmp/demo", status: "running", createdAt: store.now(), steps: [] };
    store.appendEvent(state, { runId: "demo", type: "test" });
  });
  const state = store.readState();
  assert.equal(state.runs.demo.id, "demo");
  assert.equal(state.events[0].type, "test");
  assert.equal(store.activeRunForWorkspace(state, "/tmp/demo").id, "demo");
});

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
