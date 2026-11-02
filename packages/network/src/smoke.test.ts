import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DevroostConfig } from "@devroost/config";
import { applyManagedHostsEntries, projectNetworkName, resolveRouteBindings, stopRouteProxy } from "./index.js";

test("network exports are available", () => {
  assert.equal(projectNetworkName("devroost-app"), "devroost-devroost-app");
});

test("resolveRouteBindings maps published external port and defaults https=true", () => {
  const config: DevroostConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: {
        type: "node",
        image: "node:20-alpine",
        ports: ["3001:3000"]
      }
    },
    routes: [{ host: "app.local", service: "app", port: 3000 }]
  };

  const bindings = resolveRouteBindings(config);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].externalPort, 3001);
  assert.equal(bindings[0].https, true);
});

test("resolveRouteBindings throws for unknown service", () => {
  const config: DevroostConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {},
    routes: [{ host: "broken.local", service: "missing", port: 8080 }]
  };

  assert.throws(() => resolveRouteBindings(config), /unknown service/i);
});

test("resolveRouteBindings rejects unsafe route host values", () => {
  const config: DevroostConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: {
        type: "node",
        image: "node:20-alpine",
        ports: ["3001:3000"]
      }
    },
    routes: [{ host: "app.local {", service: "app", port: 3000 }]
  };

  assert.throws(() => resolveRouteBindings(config), /invalid/i);
});

test("resolveRouteBindings supports host/ip/protocol port mappings", () => {
  const config: DevroostConfig = {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: {
        type: "node",
        image: "node:20-alpine",
        ports: ["127.0.0.1:3005:3000/tcp"]
      }
    },
    routes: [{ host: "app.local", service: "app", port: 3000 }]
  };

  const [binding] = resolveRouteBindings(config);
  assert.equal(binding.externalPort, 3005);
});

test("applyManagedHostsEntries appends and replaces project-scoped hosts blocks", () => {
  const initial = "127.0.0.1 localhost\n";

  const withManagedHosts = applyManagedHostsEntries(initial, "demo", ["demo.test", "api.demo.test"]);
  assert.match(withManagedHosts, /# >>> devroost:demo/);
  assert.match(withManagedHosts, /127\.0\.0\.1 demo\.test/);
  assert.match(withManagedHosts, /127\.0\.0\.1 api\.demo\.test/);

  const replacedHosts = applyManagedHostsEntries(withManagedHosts, "demo", ["demo.test"]);
  assert.equal((replacedHosts.match(/# >>> devroost:demo/g) ?? []).length, 1);
  assert.match(replacedHosts, /127\.0\.0\.1 demo\.test/);
  assert.doesNotMatch(replacedHosts, /api\.demo\.test/);
});

test("applyManagedHostsEntries removes project block when given no hosts", () => {
  const content = [
    "127.0.0.1 localhost",
    "",
    "# >>> devroost:demo",
    "127.0.0.1 demo.test",
    "# <<< devroost:demo",
    ""
  ].join("\n");

  const cleaned = applyManagedHostsEntries(content, "demo", []);
  assert.doesNotMatch(cleaned, /devroost:demo/);
  assert.equal(cleaned, "127.0.0.1 localhost\n");
});

test("stopRouteProxy succeeds when startup failed before proxy config was created", async () => {
  const previousCwd = process.cwd();
  const projectDir = await mkdtemp(join(tmpdir(), "devroost-network-stop-"));

  try {
    process.chdir(projectDir);
    await assert.doesNotReject(stopRouteProxy("demo", { stateDir: join(projectDir, "state") }));
  } finally {
    process.chdir(previousCwd);
    await rm(projectDir, { recursive: true, force: true });
  }
});
