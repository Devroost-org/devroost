import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const springBootStack = defineStack({
  id: "spring-boot", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "spring-boot/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "JAVA_IMAGE", reference: runtimeImagePins.maven39Temurin21 }],
  install: [], start: ["mvn spring-boot:run -Dspring-boot.run.jvmArguments=\"-Dserver.address=0.0.0.0 -Dserver.port=8080\""],
  readiness: { kind: "http", value: "http://127.0.0.1:8080/api/health", timeoutSeconds: 630 }, hostWrites: ["target"],
  verification: [{ service: "app", command: ["wget", "-q", "-O-", "http://127.0.0.1:8080/api/health"] }], devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [{ path: "target", category: "build" }], protectedPaths: ["src"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
