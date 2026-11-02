import { defineStack } from "../definition.js";
import { generatorPins, runtimeImagePins } from "../pins.js";

export const phpSymfonyStack = defineStack({
  id: "php-symfony", definitionVersion: 2, legacyScaffoldVersions: ["2", "unversioned"], assetPath: "php-symfony/templates", scaffoldVersion: "2",
  generator: {
    kind: "command", image: generatorPins.composerImage, package: "symfony/skeleton", version: generatorPins.symfonySkeleton,
    command: ["sh", "-c", `composer create-project {package}:{version} . && composer require symfony/webapp-pack:${generatorPins.symfonyWebappPack}`],
    execution: {
      kind: "container", context: "Symfony project with Podman Composer", mountTarget: "/app", workdir: "/app",
      environment: [{ name: "HOME", value: "/tmp" }]
    }
  },
  runtimeImages: [
    { env: "PHP_IMAGE", reference: runtimeImagePins.php84Apache }
  ],
  install: [],
  start: ["apache2-foreground"], readiness: { kind: "port", value: "127.0.0.1:80", timeoutSeconds: 90 },
  hostWrites: ["var/cache"], verification: [{ service: "app", command: ["php", "bin/console", "about"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [{ path: "var/cache", category: "cache" }, { path: "vendor", category: "dependency" }],
  protectedPaths: ["config", "public", "src", "templates"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
