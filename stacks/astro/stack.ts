import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const astroStack = defineStack({
  id: "astro", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "astro/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "NODE_IMAGE", reference: runtimeImagePins.node24Alpine }],
  install: ["npm install"], start: ["npx astro dev --host 0.0.0.0 --port 4321"],
  readiness: { kind: "http", value: "http://127.0.0.1:4321", timeoutSeconds: 495 }, hostWrites: ["node_modules"],
  verification: [{ service: "app", command: ["node", "-e", "fetch('http://127.0.0.1:4321').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [{ path: "dist", category: "build" }, { path: "node_modules", category: "dependency" }],
  protectedPaths: ["public", "src"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
