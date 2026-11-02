import assert from "node:assert/strict";
import test from "node:test";
import type { DevroostConfig } from "@devroost/config";
import { startConfiguredService } from "./service-start.js";

function createConfig(serviceType: string): DevroostConfig {
  return {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: {
        type: serviceType,
        image: `${serviceType}:latest`,
        ports: ["3000:3000"],
        healthcheck: {
          command: "curl -f http://127.0.0.1:3000/health"
        }
      }
    }
  };
}

test("startConfiguredService starts php services, ensures composer, and waits for readiness", async () => {
  const events: string[] = [];
  const output: string[] = [];

  await startConfiguredService(
    createConfig("php"),
    "app",
    "demo-net",
    {
      ensureServiceStarted: async (_projectName, serviceName) => {
        events.push(`start:${serviceName}`);
      },
      ensureComposerAvailable: async (_projectName, serviceName) => {
        events.push(`composer:${serviceName}`);
      },
      waitForServiceReady: async (_projectName, serviceName, healthcheck) => {
        events.push(`ready:${serviceName}`);
        assert.equal(healthcheck?.command, "curl -f http://127.0.0.1:3000/health");
        assert.deepEqual(healthcheck?.ports, ["3000:3000"]);
        assert.equal(healthcheck?.progressIntervalSeconds, 15);
        assert.equal(typeof healthcheck?.onProgress, "function");
      }
    },
    {
      writeOut(message) {
        output.push(message);
      }
    }
  );

  assert.deepEqual(events, ["start:app", "composer:app", "ready:app"]);
  assert.deepEqual(output, ["- started app\n"]);
});

test("startConfiguredService writes periodic waiting updates before reporting the service as started", async () => {
  const output: string[] = [];

  await startConfiguredService(
    createConfig("node"),
    "app",
    "demo-net",
    {
      ensureServiceStarted: async () => undefined,
      ensureComposerAvailable: async () => undefined,
      waitForServiceReady: async (_projectName, _serviceName, healthcheck) => {
        healthcheck?.onProgress?.({ elapsedSeconds: 15, detail: "health: starting" });
      }
    },
    {
      writeOut(message) {
        output.push(message);
      }
    }
  );

  assert.deepEqual(output, [
    "- waiting for app readiness (health: starting, 15s elapsed)\n",
    "- started app\n"
  ]);
});

test("startConfiguredService skips composer for non-php services", async () => {
  const events: string[] = [];

  await startConfiguredService(
    createConfig("node"),
    "app",
    "demo-net",
    {
      ensureServiceStarted: async (_projectName, serviceName) => {
        events.push(`start:${serviceName}`);
      },
      ensureComposerAvailable: async (_projectName, serviceName) => {
        events.push(`composer:${serviceName}`);
      },
      waitForServiceReady: async (_projectName, serviceName) => {
        events.push(`ready:${serviceName}`);
      }
    },
    {
      writeOut() {
        return undefined;
      }
    }
  );

  assert.deepEqual(events, ["start:app", "ready:app"]);
});

test("startConfiguredService skips composer when disabled for a php service", async () => {
  const events: string[] = [];
  const phpConfig = createConfig("php");

  await startConfiguredService(
    {
      ...phpConfig,
      services: {
        app: {
          ...phpConfig.services.app,
          composer: false
        }
      }
    },
    "app",
    "demo-net",
    {
      ensureServiceStarted: async (_projectName, serviceName) => {
        events.push(`start:${serviceName}`);
      },
      ensureComposerAvailable: async (_projectName, serviceName) => {
        events.push(`composer:${serviceName}`);
      },
      waitForServiceReady: async (_projectName, serviceName) => {
        events.push(`ready:${serviceName}`);
      }
    },
    {
      writeOut() {
        return undefined;
      }
    }
  );

  assert.deepEqual(events, ["start:app", "ready:app"]);
});