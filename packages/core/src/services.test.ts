import test from "node:test";
import assert from "node:assert/strict";
import type { DevroostConfig } from "@devroost/config";
import {
  buildServiceNotFoundError,
  getConfiguredService,
  requireConfiguredService
} from "./services.js";

const config: DevroostConfig = {
  version: 1,
  name: "demo",
  runtime: { engine: "podman", rootless: true },
  services: {
    app: { type: "node", image: "node:20-alpine" },
    cache: { type: "redis", image: "redis:7" }
  }
};

test("getConfiguredService returns a configured service when present", () => {
  const service = getConfiguredService(config, "app");

  assert.deepEqual(service, { type: "node", image: "node:20-alpine" });
});

test("buildServiceNotFoundError includes suggestions and running services", async () => {
  const error = await buildServiceNotFoundError(config, "ap", async () => [
    { name: "demo-app", running: true },
    { name: "demo-cache", running: false },
    { name: "other-foreign", running: true }
  ]);

  assert.match(error.message, /Did you mean 'app'\?/i);
  assert.match(error.message, /Available services: app, cache/i);
  assert.match(error.message, /Running services: app/i);
});

test("requireConfiguredService rejects with a service-not-found error", async () => {
  await assert.rejects(
    () => requireConfiguredService(config, "worker", async () => []),
    /Service 'worker' is not defined in devroost.yaml/i
  );
});