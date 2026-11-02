import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const nodeMeanStack = defineStack({
  id: "node-mean", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "node-mean/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "NODE_IMAGE", reference: runtimeImagePins.node24Alpine }],
  install: ["cd api && npm install", "cd web && npm install"], start: ["cd api && npm start", "cd web && npm start"],
  readiness: { kind: "http", value: "http://127.0.0.1:4200", timeoutSeconds: 325 },
  hostWrites: ["api/node_modules", "web/node_modules"],
  verification: [{ service: "web", command: ["node", "-e", "fetch('http://127.0.0.1:4200').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [{ path: "api/dist", category: "build" }, { path: "api/node_modules", category: "dependency" }, { path: "web/dist", category: "build" }, { path: "web/node_modules", category: "dependency" }],
  protectedPaths: ["api/src", "web/src"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
