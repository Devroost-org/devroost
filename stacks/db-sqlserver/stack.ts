import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

export const dbSqlserverStack = defineStack({
  id: "db-sqlserver", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "db-sqlserver/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [{ env: "MSSQL_IMAGE", reference: runtimeImagePins.mssql2022 }],
  install: [], start: [], readiness: { kind: "port", value: "127.0.0.1:1433", timeoutSeconds: 300 }, hostWrites: [],
  verification: [{ service: "db", command: ["/opt/mssql-tools18/bin/sqlcmd", "-S", "127.0.0.1", "-U", "sa", "-P", "LoomDev!Passw0rd", "-C", "-Q", "SELECT 1"] }],
  devroostOwnedFiles: [".env.example", "devroost.yaml"], generatedPaths: [], protectedPaths: [],
  compatibility: { architectures: ["x64"], runtime: "podman-rootless" }
});
