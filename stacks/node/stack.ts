import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const nodeStack = defineStack({
  id: "node",
  definitionVersion: 2,
  legacyScaffoldVersions: ["1", "2"],
  assetPath: "node/templates",
  scaffoldVersion: "2",
  generator: { kind: "none" },
  runtimeImages: [{ env: "NODE_IMAGE", reference: runtimeImagePins.node24Alpine }],
  install: ["npm install"],
  start: ["npm start"],
  readiness: { kind: "http", value: "http://127.0.0.1:3000/health", timeoutSeconds: 496 },
  hostWrites: ["node_modules"],
  verification: [{ service: "app", command: ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [
    { path: "dist", category: "build" },
    { path: "node_modules", category: "dependency" }
  ],
  protectedPaths: ["src"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
