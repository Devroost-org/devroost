import test from "node:test";
import assert from "node:assert/strict";
import type { DevroostConfig } from "@devroost/config";
import { getConfiguredTask, requireConfiguredTask } from "./tasks.js";

const config: DevroostConfig = {
  version: 1,
  name: "demo",
  runtime: { engine: "podman", rootless: true },
  services: {
    app: { type: "node", image: "node:20-alpine" }
  },
  tasks: {
    seed: {
      service: "app",
      command: "npm run seed"
    }
  }
};

test("getConfiguredTask returns a configured task when present", () => {
  const task = getConfiguredTask(config, "seed");

  assert.deepEqual(task, {
    service: "app",
    command: "npm run seed"
  });
});

test("requireConfiguredTask throws when the task is missing", () => {
  assert.throws(
    () => requireConfiguredTask(config, "missing"),
    /Task 'missing' is not defined in devroost.yaml/i
  );
});