import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const nodeT3Stack = defineStack({
  id: "node-t3", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "node-t3/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "NODE_IMAGE", reference: runtimeImagePins.node24Alpine }],
  install: ["corepack enable && pnpm install"], start: ["pnpm dev"],
  readiness: { kind: "http", value: "http://127.0.0.1:3003", timeoutSeconds: 486 }, hostWrites: ["node_modules"],
  verification: [{ service: "app", command: ["node", "-e", "fetch('http://127.0.0.1:3003').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [{ path: ".next", category: "build" }, { path: "node_modules", category: "dependency" }],
  protectedPaths: ["apps", "packages"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
