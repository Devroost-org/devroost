import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const dbRedisStack = defineStack({
  id: "db-redis", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "db-redis/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "REDIS_IMAGE", reference: runtimeImagePins.redis74Alpine }],
  install: [], start: ["redis-server --appendonly yes"],
  readiness: { kind: "command", value: "redis-cli ping | grep PONG", timeoutSeconds: 92 }, hostWrites: [],
  verification: [{ service: "db", command: ["redis-cli", "ping"] }], devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [], protectedPaths: [],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
