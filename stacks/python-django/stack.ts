import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const pythonDjangoStack = defineStack({
  id: "python-django", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "python-django/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }],
  install: ["pip install --user -r requirements.txt"],
  start: ["python manage.py migrate --noinput", "python manage.py runserver 0.0.0.0:8001"],
  readiness: { kind: "http", value: "http://127.0.0.1:8001/health", timeoutSeconds: 488 },
  hostWrites: ["db.sqlite3", "project/__pycache__"],
  verification: [{ service: "app", command: ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=2)"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [
    { path: ".pytest_cache", category: "cache" }, { path: ".venv", category: "dependency" },
    { path: "__pycache__", category: "cache" }
  ],
  protectedPaths: ["manage.py", "project", "requirements.txt"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
