import test from "node:test";
import assert from "node:assert/strict";
import type { LoomConfig } from "@loom/config";
import { defaultOrchestratorDependencies } from "./dependencies.js";
import {
  backupAllConfiguredServices,
  backupConfiguredService,
  listBackupSupportedServices,
  requireBackupExtension,
  resolveBackupOutputPath
} from "./backup.js";

test("listBackupSupportedServices filters services by supported backup type", () => {
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" },
      db: { type: "postgres", image: "postgres:16" },
      cache: { type: "redis", image: "redis:7" }
    }
  };

  const supported = listBackupSupportedServices(config, (serviceType) =>
    ["postgres", "redis"].includes(serviceType) ? "dump" : null
  );

  assert.deepEqual(
    supported.map(([serviceName]) => serviceName),
    ["db", "cache"]
  );
});

test("requireBackupExtension returns the extension for supported services", () => {
  const extension = requireBackupExtension(
    "db",
    "postgres",
    ["postgres", "redis"],
    (serviceType) => (serviceType === "postgres" ? "sql" : null)
  );

  assert.equal(extension, "sql");
});

test("requireBackupExtension throws for unsupported services", () => {
  assert.throws(
    () =>
      requireBackupExtension("app", "node", ["postgres", "redis"], () => null),
    /not currently supported/i
  );
});

test("resolveBackupOutputPath uses explicit and generated output paths", () => {
  const explicit = resolveBackupOutputPath("/workspace", "demo", "db", "sql", "tmp/backup.sql");
  const generated = resolveBackupOutputPath(
    "/workspace",
    "demo",
    "db",
    "sql",
    undefined,
    new Date("2026-03-11T10:20:30.000Z")
  );

  assert.equal(explicit, "/workspace/tmp/backup.sql");
  assert.equal(generated, "/workspace/.devroost/backups/demo-db-2026-03-11T10-20-30.000Z.sql");
});

test("backupConfiguredService validates the service and writes to the resolved path", async () => {
  const savedPaths: string[] = [];
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      db: { type: "postgres", image: "postgres:16" }
    }
  };

  const finalPath = await backupConfiguredService(config, "/workspace", "db", {
    backupExtensionForServiceType: (serviceType) => (serviceType === "postgres" ? "sql" : null),
    backupServiceToFile: async (_projectName, _serviceName, _service, outputPath) => {
      savedPaths.push(outputPath);
    },
    listProjectContainers: async () => [],
    supportedBackupServiceTypes: defaultOrchestratorDependencies.supportedBackupServiceTypes
  }, "tmp/backup.sql");

  assert.equal(finalPath, "/workspace/tmp/backup.sql");
  assert.deepEqual(savedPaths, ["/workspace/tmp/backup.sql"]);
});

test("backupAllConfiguredServices rejects when no supported backup services exist", async () => {
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  await assert.rejects(
    () =>
      backupAllConfiguredServices(config, "/workspace", {
        backupExtensionForServiceType: () => null,
        backupServiceToFile: async () => undefined,
        listProjectContainers: async () => [],
        supportedBackupServiceTypes: defaultOrchestratorDependencies.supportedBackupServiceTypes
      }),
    /No backup-supported services found/i
  );
});