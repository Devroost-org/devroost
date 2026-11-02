import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const bunStack = defineStack({
  id: "bun", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "bun/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "BUN_IMAGE", reference: runtimeImagePins.bun1 }],
  install: [], start: ["bun run dev"], readiness: { kind: "http", value: "http://127.0.0.1:3004/", timeoutSeconds: 250 },
  hostWrites: [], verification: [{ service: "app", command: ["bun", "-e", "fetch('http://127.0.0.1:3004/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [], protectedPaths: ["index.ts"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
