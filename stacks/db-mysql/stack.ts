import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const dbMysqlStack = defineStack({
  id: "db-mysql", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "db-mysql/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "MYSQL_IMAGE", reference: runtimeImagePins.mysql84 }],
  install: [], start: [],
  readiness: { kind: "command", value: "mysqladmin ping -h 127.0.0.1 -uroot -pdevroostroot", timeoutSeconds: 100 },
  hostWrites: [], verification: [{ service: "db", command: ["mysql", "-h", "127.0.0.1", "-udevroost", "-pdevroost", "devroost", "-e", "SELECT 1"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [], protectedPaths: [],
  compatibility: { architectures: ["arm64", "x64"], runtime: "podman-rootless" }
});
