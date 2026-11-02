import { defineStack } from "../definition.js";
import { generatorPins, runtimeImagePins } from "../pins.js";

export const phpWordpressStack = defineStack({
  id: "php-wordpress", definitionVersion: 2, legacyScaffoldVersions: ["2", "wordpress-6-php8.3-apache"], assetPath: "php-wordpress/templates", scaffoldVersion: "2",
  generator: {
    kind: "command", image: runtimeImagePins.wordpress683Php84Apache, package: "wordpress", version: generatorPins.wordpress,
    command: ["sh", "-c", "cp -a /usr/src/wordpress/. /app/"],
    execution: { kind: "container", context: "WordPress project with Podman", mountTarget: "/app", environment: [] }
  },
  runtimeImages: [
    { env: "WORDPRESS_IMAGE", reference: runtimeImagePins.wordpress683Php84Apache }
  ],
  install: [],
  start: ["docker-entrypoint.sh apache2-foreground"], readiness: { kind: "port", value: "127.0.0.1:80", timeoutSeconds: 90 },
  hostWrites: ["wp-content"], verification: [{ service: "app", command: ["php", "-r", "exit((int)!@fsockopen('127.0.0.1', 80));"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml", "wp-config.php"], generatedPaths: [], protectedPaths: ["wp-content"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
