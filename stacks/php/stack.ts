import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const phpStack = defineStack({
  id: "php", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "php/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [
    { env: "PHP_IMAGE", reference: runtimeImagePins.php84Apache }
  ],
  install: [],
  start: ["apache2-foreground"], readiness: { kind: "port", value: "127.0.0.1:80", timeoutSeconds: 90 }, hostWrites: [],
  verification: [{ service: "app", command: ["php", "-r", "exit((int)!@fsockopen('127.0.0.1', 80));"] }], devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [{ path: "vendor", category: "dependency" }], protectedPaths: ["index.php"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
