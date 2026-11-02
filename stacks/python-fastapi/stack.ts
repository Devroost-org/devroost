import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const pythonFastapiStack = defineStack({
  id: "python-fastapi", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "python-fastapi/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }],
  install: ["pip install --user -r requirements.txt"], start: ["uvicorn app.main:app --host 0.0.0.0 --port 8003"],
  readiness: { kind: "http", value: "http://127.0.0.1:8003/health", timeoutSeconds: 488 }, hostWrites: ["app/__pycache__"],
  verification: [{ service: "app", command: ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8003/health', timeout=2)"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [
    { path: ".pytest_cache", category: "cache" }, { path: ".venv", category: "dependency" },
    { path: "__pycache__", category: "cache" }
  ],
  protectedPaths: ["app", "requirements.txt"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
