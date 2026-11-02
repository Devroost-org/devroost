import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const dotnetStack = defineStack({
  id: "dotnet", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "dotnet/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "DOTNET_IMAGE", reference: runtimeImagePins.dotnet8Sdk }],
  install: ["dotnet restore"], start: ["dotnet run --urls http://0.0.0.0:5000"],
  readiness: { kind: "http", value: "http://127.0.0.1:5000/", timeoutSeconds: 330 }, hostWrites: ["src/bin", "src/obj"],
  verification: [{ service: "app", command: ["wget", "-qO", "/dev/null", "http://127.0.0.1:5000/"] }], devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [{ path: "src/bin", category: "build" }, { path: "src/obj", category: "build" }], protectedPaths: ["src"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
