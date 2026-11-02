import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const pythonStack = defineStack({
  id: "python", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "python/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }],
  install: [], start: ["python -m http.server 8000"],
  readiness: { kind: "http", value: "http://127.0.0.1:8000/", timeoutSeconds: 366 }, hostWrites: [],
  verification: [{ service: "app", command: ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=2)"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [
    { path: ".pytest_cache", category: "cache" }, { path: ".venv", category: "dependency" },
    { path: "__pycache__", category: "cache" }
  ], protectedPaths: ["index.html"],
  compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
