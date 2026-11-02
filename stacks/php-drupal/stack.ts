import { defineStack } from "../definition.js";
import { generatorPins, runtimeImagePins } from "../pins.js";

export const phpDrupalStack = defineStack({
  id: "php-drupal", definitionVersion: 2, legacyScaffoldVersions: ["2", "unversioned"], assetPath: "php-drupal/templates", scaffoldVersion: "2",
  generator: {
    kind: "command", image: generatorPins.composerImage, package: "drupal/recommended-project", version: generatorPins.drupalRecommendedProject,
    command: ["create-project", "{package}:{version}", "."],
    execution: {
      kind: "container", context: "Drupal project with Podman Composer", mountTarget: "/app", workdir: "/app",
      environment: [{ name: "HOME", value: "/tmp" }]
    }
  },
  runtimeImages: [
    { env: "PHP_IMAGE", reference: runtimeImagePins.php84Apache }
  ],
  install: [],
  start: ["apache2-foreground"], readiness: { kind: "port", value: "127.0.0.1:80", timeoutSeconds: 90 },
  hostWrites: ["data/files"], verification: [{ service: "app", command: ["php", "-r", "exit((int)!@fsockopen('127.0.0.1', 80));"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [{ path: "vendor", category: "dependency" }],
  protectedPaths: ["modules", "themes", "web"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
