import test from "node:test";
import assert from "node:assert/strict";
import type { DevroostConfig } from "@devroost/config";
import { DevroostOrchestrator, stopProjectResources } from "./index.js";

test("core exports are available", () => {
  assert.equal(typeof DevroostOrchestrator, "function");
});

test("backupAll rejects when project has no backup-supported services", async () => {
  const config: DevroostConfig = {
    version: 1,
    name: "no-db-project",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const orchestrator = new DevroostOrchestrator(config, process.cwd());
  await assert.rejects(() => orchestrator.backupAll(), /No backup-supported services found/i);
});

test("stopProjectResources attempts all services and aggregates errors", async () => {
  const stopped: string[] = [];
  const log: string[] = [];

  await assert.rejects(
    () =>
      stopProjectResources("demo", ["a", "b", "c"], {
        stopServiceByName: async (_projectName, serviceName) => {
          if (serviceName === "b") {
            throw new Error("stop failed");
          }

          stopped.push(serviceName);
        },
        stopRouteProxyByProject: async () => {
          throw new Error("proxy failed");
        },
        writeOut: (message) => {
          log.push(message);
        },
        writeErr: (message) => {
          log.push(message);
        }
      }),
    /service 'b': stop failed[\s\S]*route proxy: proxy failed/i
  );

  assert.deepEqual(stopped, ["a", "c"]);
  assert.ok(log.some((entry) => entry.includes("failed stopping b")));
  assert.ok(log.some((entry) => entry.includes("failed stopping route proxy")));
});

test("stopProjectResources succeeds when all stop operations succeed", async () => {
  const stopped: string[] = [];
  let proxyStopped = false;

  await stopProjectResources("demo", ["a", "b"], {
    stopServiceByName: async (_projectName, serviceName) => {
      stopped.push(serviceName);
    },
    stopRouteProxyByProject: async () => {
      proxyStopped = true;
    },
    writeOut: () => undefined,
    writeErr: () => undefined
  });

  assert.deepEqual(stopped, ["a", "b"]);
  assert.equal(proxyStopped, true);
});
