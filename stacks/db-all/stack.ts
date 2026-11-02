import { defineStack } from "../definition.js";
import { runtimeImagePins } from "../pins.js";

const sqliteStart = "sh -c \"sqlite3 /data/devroost.db 'select 1;' && tail -f /dev/null\"";

export const dbAllStack = defineStack({
  id: "db-all", definitionVersion: 2, legacyScaffoldVersions: ["1", "2"], assetPath: "db-all/templates", scaffoldVersion: "2",
  generator: { kind: "none" }, runtimeImages: [
    { env: "ELASTICSEARCH_IMAGE", reference: runtimeImagePins.elasticsearch819 },
    { env: "MARIADB_IMAGE", reference: runtimeImagePins.mariadb118 },
    { env: "MONGO_IMAGE", reference: runtimeImagePins.mongo70 },
    { env: "MSSQL_IMAGE", reference: runtimeImagePins.mssql2022 },
    { env: "MYSQL_IMAGE", reference: runtimeImagePins.mysql84 },
    { env: "POSTGRES_IMAGE", reference: runtimeImagePins.postgres16Alpine },
    { env: "REDIS_IMAGE", reference: runtimeImagePins.redis74Alpine },
    { env: "SQLITE_IMAGE", reference: runtimeImagePins.sqlite353 }
  ],
  install: [], start: ["redis-server --appendonly yes", sqliteStart],
  readiness: { kind: "http", value: "http://127.0.0.1:9200/_cluster/health", timeoutSeconds: 300 },
  hostWrites: [], verification: [
    { service: "mysql", command: ["mysql", "-h", "127.0.0.1", "-udevroost", "-pdevroost", "devroost", "-e", "SELECT 1"] },
    { service: "sqlserver", command: ["/opt/mssql-tools18/bin/sqlcmd", "-S", "127.0.0.1", "-U", "sa", "-P", "DevroostDev!Passw0rd", "-C", "-Q", "SELECT 1"] },
    { service: "postgres", command: ["psql", "-U", "devroost", "-d", "devroost", "-c", "SELECT 1"] },
    { service: "mongodb", command: ["mongosh", "--quiet", "--host", "127.0.0.1", "--username", "devroost", "--password", "devroost", "--authenticationDatabase", "admin", "--eval", "quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)"] },
    { service: "redis", command: ["redis-cli", "ping"] },
    { service: "elasticsearch", command: ["curl", "--fail", "http://127.0.0.1:9200/_cluster/health"] },
    { service: "sqlite", command: ["sqlite3", "/data/devroost.db", "select 1;"] },
    { service: "mariadb", command: ["mariadb", "-h", "127.0.0.1", "-udevroost", "-pdevroost", "devroost", "-e", "SELECT 1"] }
  ], devroostOwnedFiles: [".env.example", "devroost.yaml"],
  generatedPaths: [], protectedPaths: [], compatibility: { architectures: ["x64"], runtime: "podman-rootless" }
});
