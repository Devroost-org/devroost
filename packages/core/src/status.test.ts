import test from "node:test";
import assert from "node:assert/strict";
import type { DevroostConfig } from "@devroost/config";
import { buildDevroostStatus } from "./status.js";

test("buildDevroostStatus assembles routes, https info, and service inspection", async () => {
  const config: DevroostConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const status = await buildDevroostStatus(config, {
    containerName: (projectName, serviceName) => `${projectName}-${serviceName}`,
    detectPodmanCapabilities: async () => ({
      available: true,
      version: "5.4.0",
      rootless: true,
      machine: {
        supported: false,
        running: true
      }
    }),
    ensureLocalCertificates: async () => ({ certPath: "/tmp/cert.pem", keyPath: "/tmp/key.pem" }),
    inspectContainer: async () => ({
      name: "demo-app",
      state: "running",
      running: true,
      health: "healthy",
      image: "node:20-alpine"
    }),
    isContainerRunning: async () => true,
    resolveRouteBindings: () => [
      {
        host: "demo.test",
        service: "app",
        targetPort: 3000,
        externalPort: 8080,
        https: true
      }
    ]
  });

  assert.equal(status.project, "demo");
  assert.deepEqual(status.routes, [
    {
      host: "demo.test",
      target: "app:3000",
      https: true
    }
  ]);
  assert.deepEqual(status.services, [
    {
      name: "app",
      image: "node:20-alpine",
      container: "demo-app",
      running: true,
      state: "running",
      health: "healthy"
    }
  ]);
  assert.deepEqual(status.https, {
    certPath: "/tmp/cert.pem",
    keyPath: "/tmp/key.pem"
  });
  assert.deepEqual(status.proxy, { httpPort: 8080, httpsPort: 8443 });
});

test("buildDevroostStatus omits https and proxy when no routes exist", async () => {
  const config: DevroostConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const status = await buildDevroostStatus(config, {
    containerName: (projectName, serviceName) => `${projectName}-${serviceName}`,
    detectPodmanCapabilities: async () => ({
      available: true,
      version: "5.4.0",
      rootless: true,
      machine: {
        supported: false,
        running: true
      }
    }),
    ensureLocalCertificates: async () => {
      throw new Error("should not request certs without routes");
    },
    inspectContainer: async () => null,
    isContainerRunning: async () => false,
    resolveRouteBindings: () => []
  });

  assert.equal(status.https, undefined);
  assert.equal(status.proxy, undefined);
});