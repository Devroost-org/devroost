import test from "node:test";
import assert from "node:assert/strict";
import type { LoomConfig } from "@loom/config";
import { defaultOrchestratorDependencies } from "./dependencies.js";
import {
  requireRestoreSupport,
  resolveRestoreInputPath,
  restoreConfiguredService
} from "./restore.js";

test("resolveRestoreInputPath resolves relative restore file paths", () => {
  assert.equal(resolveRestoreInputPath("/workspace", "tmp/backup.sql"), "/workspace/tmp/backup.sql");
});

test("requireRestoreSupport accepts supported service types", () => {
  assert.doesNotThrow(() => {
    requireRestoreSupport("db", "postgres", ["postgres", "mysql"]);
  });
});

test("requireRestoreSupport rejects unsupported service types", () => {
  assert.throws(
    () => requireRestoreSupport("cache", "redis", ["postgres", "mysql"]),
    /not currently supported by 'devroost restore'/i
  );
});

test("restoreConfiguredService validates the service and resolves the input path", async () => {
  const restoredPaths: string[] = [];
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      db: { type: "postgres", image: "postgres:16" }
    }
  };

  const finalPath = await restoreConfiguredService(config, "/workspace", "db", "tmp/backup.sql", {
    listProjectContainers: async () => [],
    stopService: async () => undefined,
    restoreServiceFromFile: async (_projectName, _serviceName, _service, inputPath) => {
      restoredPaths.push(inputPath);
    },
    ensureServiceNetwork: async () => "demo-net",
    ensureServiceStarted: async () => undefined,
    waitForServiceReady: async () => undefined,
    supportedRestoreServiceTypes: defaultOrchestratorDependencies.supportedRestoreServiceTypes
  });

  assert.equal(finalPath, "/workspace/tmp/backup.sql");
  assert.deepEqual(restoredPaths, ["/workspace/tmp/backup.sql"]);
});

test("restoreConfiguredService restarts redis after copying the backup file", async () => {
  const events: string[] = [];
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      db: { type: "redis", image: "redis:7" }
    }
  };

  const finalPath = await restoreConfiguredService(config, "/workspace", "db", "tmp/dump.rdb", {
    listProjectContainers: async () => [],
    stopService: async () => {
      events.push("stop");
    },
    restoreServiceFromFile: async (_projectName, _serviceName, _service, inputPath) => {
      events.push(`restore:${inputPath}`);
    },
    ensureServiceNetwork: async () => {
      events.push("network");
      return "demo-net";
    },
    ensureServiceStarted: async () => {
      events.push("start");
    },
    waitForServiceReady: async () => {
      events.push("ready");
    },
    supportedRestoreServiceTypes: defaultOrchestratorDependencies.supportedRestoreServiceTypes
  });

  assert.equal(finalPath, "/workspace/tmp/dump.rdb");
  assert.deepEqual(events, ["stop", "restore:/workspace/tmp/dump.rdb", "network", "start", "ready"]);
});

test("requireRestoreSupport explains the current SQL Server limitation", () => {
  assert.throws(
    () => requireRestoreSupport("db", "sqlserver", defaultOrchestratorDependencies.supportedRestoreServiceTypes),
    /SQL Server restore is not yet supported/i
  );
});