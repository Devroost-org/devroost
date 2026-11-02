import test from "node:test";
import assert from "node:assert/strict";
import type { LoomConfig } from "@loom/config";
import { defaultOrchestratorDependencies, type OrchestratorDependencies } from "./dependencies.js";
import { LoomOrchestrator } from "./index.js";
import type { OrchestratorOutput } from "./output.js";

function createTestDependencies(overrides: Partial<OrchestratorDependencies> = {}): OrchestratorDependencies {
  return {
    ...defaultOrchestratorDependencies,
    backupExtensionForServiceType: () => null,
    backupServiceToFile: async () => undefined,
    restoreServiceFromFile: async () => undefined,
    supportedBackupServiceTypes: defaultOrchestratorDependencies.supportedBackupServiceTypes,
    supportedRestoreServiceTypes: defaultOrchestratorDependencies.supportedRestoreServiceTypes,
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
    ensureComposerAvailable: async () => undefined,
    ensureLocalCertificates: async () => ({ certPath: "/tmp/cert.pem", keyPath: "/tmp/key.pem" }),
    ensureMachineRunning: async () => undefined,
    ensureRouteHosts: async () => ({ managedHosts: [], skippedHosts: [] }),
    ensureRouteProxy: async () => ({ containerName: "loom-proxy", httpPort: 8080, httpsPort: 8443 }),
    ensureServiceNetwork: async () => "demo-net",
    ensureServiceStarted: async () => undefined,
    execServiceCommand: async () => undefined,
    inspectContainer: async () => null,
    isContainerRunning: async () => false,
    listProjectContainers: async () => [],
    resolveRouteBindings: () => [],
    stopRouteHosts: async () => undefined,
    stopRouteProxy: async () => undefined,
    stopService: async () => undefined,
    tailServiceLogs: async () => undefined,
    waitForServiceReady: async () => undefined,
    ...overrides
  };
}

function createOutputCapture(): { output: OrchestratorOutput; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];

  return {
    output: {
      writeOut(message) {
        lines.push(message);
      },
      writeErr(message) {
        errors.push(message);
      }
    },
    lines,
    errors
  };
}

test("start uses injected dependencies instead of direct runtime bindings", async () => {
  const events: string[] = [];
  const { output, lines } = createOutputCapture();
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "php", image: "php:8.3-cli" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      ensureMachineRunning: async () => {
        events.push("machine");
      },
      detectPodmanCapabilities: async () => {
        events.push("capabilities");
        return {
          available: true,
          version: "5.4.0",
          rootless: true,
          machine: {
            supported: false,
            running: true
          }
        };
      },
      ensureServiceNetwork: async () => {
        events.push("network");
        return "demo-net";
      },
      resolveRouteBindings: () => {
        events.push("routes");
        return [];
      },
      ensureServiceStarted: async (_projectName, serviceName) => {
        events.push(`start:${serviceName}`);
      },
      ensureComposerAvailable: async (_projectName, serviceName) => {
        events.push(`composer:${serviceName}`);
      },
      waitForServiceReady: async (_projectName, serviceName) => {
        events.push(`ready:${serviceName}`);
      }
    }),
    output
  );

  await orchestrator.start();

  assert.deepEqual(events, [
    "machine",
    "capabilities",
    "network",
    "routes",
    "start:app",
    "composer:app",
    "ready:app"
  ]);
  assert.deepEqual(lines, [
    "Note: Startup may take a few minutes while Devroost downloads images and installs dependencies. Starts using cached resources are usually faster.\n",
    "Starting 1 service(s) for demo on network demo-net...\n",
    "- started app\n"
  ]);
});

test("status uses injected dependencies to assemble service state", async () => {
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      resolveRouteBindings: () => [
        {
          host: "demo.test",
          service: "app",
          targetPort: 3000,
          externalPort: 8080,
          https: true
        }
      ],
      inspectContainer: async () => ({
        name: "demo-app",
        state: "running",
        running: true,
        health: "healthy",
        image: "node:20-alpine"
      }),
      isContainerRunning: async () => true
    })
  );

  const status = await orchestrator.status();

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
});

test("start writes formatted route and https summaries through the output adapter", async () => {
  const { output, lines } = createOutputCapture();
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      resolveRouteBindings: () => [
        {
          host: "demo.test",
          service: "app",
          targetPort: 3000,
          externalPort: 8080,
          https: true
        }
      ],
      ensureServiceStarted: async () => undefined,
      waitForServiceReady: async () => undefined
    }),
    output
  );

  await orchestrator.start();

  assert.deepEqual(lines, [
    "Note: Startup may take a few minutes while Devroost downloads images and installs dependencies. Starts using cached resources are usually faster.\n",
    "Starting 1 service(s) for demo on network demo-net...\n",
    "- started app\n",
    "Route bindings:\n",
    "- https://demo.test:8443 -> app:3000 (direct: http://localhost:8080/)\n",
    "Route proxy listener ports: http://localhost:8080 https://localhost:8443 (use with configured route hostnames)\n",
    "\n→ Open https://demo.test:8443 in your browser\n",
    "HTTPS cert: /tmp/cert.pem\n",
    "HTTPS key: /tmp/key.pem\n"
  ]);
});

test("start reports managed Windows hosts entries when route host setup succeeds", async () => {
  const { output, lines } = createOutputCapture();
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      resolveRouteBindings: () => [
        {
          host: "demo.test",
          service: "app",
          targetPort: 3000,
          externalPort: 8080,
          https: true
        }
      ],
      ensureRouteHosts: async () => ({ managedHosts: ["demo.test"], skippedHosts: [] })
    }),
    output
  );

  await orchestrator.start();

  assert.ok(lines.includes("Hosts entries added: demo.test -> 127.0.0.1\n"));
});

test("stop cleans route hosts through injected dependencies", async () => {
  const events: string[] = [];
  const { output, lines } = createOutputCapture();
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      stopService: async (_projectName, serviceName) => {
        events.push(`service:${serviceName}`);
      },
      stopRouteProxy: async () => {
        events.push("proxy");
      },
      stopRouteHosts: async () => {
        events.push("hosts");
      }
    }),
    output
  );

  await orchestrator.stop();

  assert.deepEqual(events, ["service:app", "proxy", "hosts"]);
  assert.deepEqual(lines, [
    "Stopping 1 service(s) for demo...\n",
    "- stopped app\n",
    "- stopped route proxy\n",
    "- cleaned route hosts\n"
  ]);
});

test("start with recreate removes existing project containers before starting services", async () => {
  const events: string[] = [];
  const { output, lines } = createOutputCapture();
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      listProjectContainers: async () => [
        { name: "demo-app", state: "exited", running: false, image: "node:20-alpine" },
        { name: "demo-proxy", state: "exited", running: false, image: "docker.io/library/caddy:2-alpine" }
      ],
      removeContainer: async (name) => {
        events.push(`remove:${name}`);
      },
      ensureServiceNetwork: async () => {
        events.push("network");
        return "demo-net";
      },
      resolveRouteBindings: () => {
        events.push("routes");
        return [];
      },
      ensureServiceStarted: async (_projectName, serviceName) => {
        events.push(`start:${serviceName}`);
      },
      waitForServiceReady: async (_projectName, serviceName) => {
        events.push(`ready:${serviceName}`);
      }
    }),
    output
  );

  await orchestrator.start({ recreate: true });

  assert.deepEqual(events, ["remove:demo-app", "remove:demo-proxy", "network", "routes", "start:app", "ready:app"]);
  assert.deepEqual(lines, [
    "Recreating 2 existing container(s) for demo...\n",
    "- removed demo-app\n",
    "- removed demo-proxy\n",
    "Note: Startup may take a few minutes while Devroost downloads images and installs dependencies. Starts using cached resources are usually faster.\n",
    "Starting 1 service(s) for demo on network demo-net...\n",
    "- started app\n"
  ]);
});

test("backup uses extracted backup helpers to resolve the output path", async () => {
  const savedPaths: string[] = [];
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      db: { type: "postgres", image: "postgres:16" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    "/workspace",
    createTestDependencies({
      backupExtensionForServiceType: (serviceType) => (serviceType === "postgres" ? "sql" : null),
      backupServiceToFile: async (_projectName, _serviceName, _service, outputPath) => {
        savedPaths.push(outputPath);
      }
    })
  );

  const explicitPath = await orchestrator.backup("db", "tmp/backup.sql");

  assert.equal(explicitPath, "/workspace/tmp/backup.sql");
  assert.deepEqual(savedPaths, ["/workspace/tmp/backup.sql"]);
});

test("restore uses extracted restore helpers to resolve the input path", async () => {
  const restoredPaths: string[] = [];
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      db: { type: "postgres", image: "postgres:16" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    "/workspace",
    createTestDependencies({
      restoreServiceFromFile: async (_projectName, _serviceName, _service, inputPath) => {
        restoredPaths.push(inputPath);
      }
    })
  );

  const resolvedPath = await orchestrator.restore("db", "tmp/backup.sql");

  assert.equal(resolvedPath, "/workspace/tmp/backup.sql");
  assert.deepEqual(restoredPaths, ["/workspace/tmp/backup.sql"]);
});

test("restore restarts redis through the orchestrator dependencies", async () => {
  const events: string[] = [];
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      db: { type: "redis", image: "redis:7" }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    "/workspace",
    createTestDependencies({
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
      }
    })
  );

  const resolvedPath = await orchestrator.restore("db", "tmp/dump.rdb");

  assert.equal(resolvedPath, "/workspace/tmp/dump.rdb");
  assert.deepEqual(events, ["stop", "restore:/workspace/tmp/dump.rdb", "network", "start", "ready"]);
});

test("runTask reports command execution through the output adapter", async () => {
  const { output, lines } = createOutputCapture();
  const executed: string[][] = [];
  const config: LoomConfig = {
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

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      execServiceCommand: async (_projectName, _serviceName, command) => {
        executed.push(command);
      }
    }),
    output
  );

  await orchestrator.runTask("seed");

  assert.deepEqual(lines, ["Running task 'seed' in service 'app': npm run seed\n"]);
  assert.deepEqual(executed, [["sh", "-c", "npm run seed"]]);
});

test("runTask and exec pass execUser through to runtime exec", async () => {
  const calls: Array<{ service: string; command: string[]; execUser?: string; workdir?: string }> = [];
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine", execUser: "1000:1000", workdir: "/workspace" }
    },
    tasks: {
      seed: {
        service: "app",
        command: "npm run seed"
      }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      execServiceCommand: async (_projectName, serviceName, command, execUser, workdir) => {
        calls.push({ service: serviceName, command, execUser, workdir });
      }
    })
  );

  await orchestrator.runTask("seed");
  await orchestrator.exec("app", ["id"]);

  assert.deepEqual(calls, [
    { service: "app", command: ["sh", "-c", "npm run seed"], execUser: "1000:1000", workdir: "/workspace" },
    { service: "app", command: ["id"], execUser: "1000:1000", workdir: "/workspace" }
  ]);
});

test("runTask rejects when the requested task is not defined", async () => {
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };

  const orchestrator = new LoomOrchestrator(config, process.cwd(), createTestDependencies());

  await assert.rejects(() => orchestrator.runTask("seed"), /Task 'seed' is not defined in devroost.yaml/i);
});

test("stop routes progress and failures through the output adapter", async () => {
  const { output, lines, errors } = createOutputCapture();
  const config: LoomConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" },
      db: { type: "postgres", image: "postgres:16", dependsOn: ["app"] }
    }
  };

  const orchestrator = new LoomOrchestrator(
    config,
    process.cwd(),
    createTestDependencies({
      stopService: async (_projectName, serviceName) => {
        if (serviceName === "db") {
          throw new Error("stop failed");
        }
      },
      stopRouteProxy: async () => undefined
    }),
    output
  );

  await assert.rejects(() => orchestrator.stop(), /stop failed/i);
  assert.deepEqual(lines, [
    "Stopping 2 service(s) for demo...\n",
    "- stopped app\n",
    "- stopped route proxy\n"
    ,"- cleaned route hosts\n"
  ]);
  assert.deepEqual(errors, ["- failed stopping db: stop failed\n"]);
});
