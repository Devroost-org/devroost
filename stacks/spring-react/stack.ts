import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const springReactStack = defineStack({
  id: "spring-react", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "spring-react/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [
    { env: "JAVA_IMAGE", reference: runtimeImagePins.maven39Temurin21 },
    { env: "NODE_IMAGE", reference: runtimeImagePins.node22Alpine }
  ],
  install: ["cd frontend && npm install"],
  start: [
    "cd backend && mvn spring-boot:run -Dspring-boot.run.jvmArguments=\"-Dserver.address=0.0.0.0 -Dserver.port=8080\"",
    "cd frontend && npm run build", "cd frontend && npm run serve"
  ],
  readiness: { kind: "http", value: "http://127.0.0.1:5175", timeoutSeconds: 410 },
  hostWrites: ["backend/target", "frontend/dist", "frontend/node_modules"],
  verification: [{ service: "web", command: ["node", "-e", "fetch('http://127.0.0.1:5175').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [{ path: "backend/target", category: "build" }, { path: "frontend/dist", category: "build" }, { path: "frontend/node_modules", category: "dependency" }],
  protectedPaths: ["backend/src", "frontend/src"], compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
});
