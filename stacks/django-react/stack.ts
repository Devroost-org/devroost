import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const djangoReactStack = defineStack({
  id: "django-react", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "django-react/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [
    { env: "NODE_IMAGE", reference: runtimeImagePins.node24Alpine },
    { env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }
  ],
  install: [
    "cd backend && pip install --disable-pip-version-check --user -r requirements.txt",
    "cd frontend && npm install --no-audit --no-fund"
  ],
  start: [
    "cd backend && python manage.py migrate --noinput", "cd backend && python manage.py runserver 0.0.0.0:8001",
    "cd frontend && npm run dev -- --host 0.0.0.0 --port 5176"
  ],
  readiness: { kind: "http", value: "http://127.0.0.1:5176", timeoutSeconds: 485 },
  hostWrites: ["backend/db.sqlite3", "backend/project/__pycache__", "frontend/node_modules", "frontend/package-lock.json"],
  verification: [{ service: "web", command: ["node", "-e", "fetch('http://127.0.0.1:5176').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [
    { path: "backend/.pytest_cache", category: "cache" }, { path: "backend/.venv", category: "dependency" },
    { path: "frontend/dist", category: "build" },
    { path: "frontend/node_modules", category: "dependency" }
  ],
  protectedPaths: ["backend/project", "frontend/src"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
