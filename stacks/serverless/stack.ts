import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const serverlessStack = defineStack({
  id: "serverless", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "serverless/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "NODE_IMAGE", reference: runtimeImagePins.node22Alpine }],
  install: [], start: ["npm run dev:api", "npm run dev:web"],
  readiness: { kind: "http", value: "http://127.0.0.1:3008", timeoutSeconds: 326 }, hostWrites: [],
  verification: [{ service: "api", command: ["npm", "run", "invoke:health"] }], devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [], protectedPaths: ["dev-server.js", "handler.js", "web", "web-server.js"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
