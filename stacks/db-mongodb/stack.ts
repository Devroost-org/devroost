import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const dbMongodbStack = defineStack({
  id: "db-mongodb", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "db-mongodb/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "MONGO_IMAGE", reference: runtimeImagePins.mongo70 }],
  install: [], start: [], readiness: { kind: "port", value: "127.0.0.1:27017", timeoutSeconds: 120 }, hostWrites: [],
  verification: [{ service: "db", command: ["mongosh", "--quiet", "--host", "127.0.0.1", "--username", "loom", "--password", "loom", "--authenticationDatabase", "admin", "--eval", "quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [], protectedPaths: [],
  compatibility: { architectures: ["arm64", "x64"], runtime: "podman-rootless" }
});
