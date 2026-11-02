import path from "node:path";
import { pathToFileURL } from "node:url";

import { run } from "./process.mjs";

const probes = {
  "postgres-16": {
    environment: ["POSTGRES_PASSWORD=devroost-test"],
    command: ["pg_isready", "-U", "postgres"]
  },
  "mysql-8.4": {
    environment: ["MYSQL_ROOT_PASSWORD=devroost-test"],
    command: ["mysql", "-h", "127.0.0.1", "-uroot", "-pdevroost-test", "--execute", "SELECT 1"]
  },
  "mariadb-11.8": {
    environment: ["MARIADB_ROOT_PASSWORD=devroost-test"],
    command: ["healthcheck.sh", "--connect", "--innodb_initialized"]
  },
  "redis-7.4": {
    environment: [],
    command: ["redis-cli", "ping"]
  },
  "mongo-7.0": {
    environment: [
      "MONGO_INITDB_ROOT_USERNAME=devroost",
      "MONGO_INITDB_ROOT_PASSWORD=devroost-test"
    ],
    command: [
      "mongosh",
      "--quiet",
      "--username",
      "devroost",
      "--password",
      "devroost-test",
      "--authenticationDatabase",
      "admin",
      "--eval",
      "db.runCommand({ ping: 1 })"
    ]
  },
  "elasticsearch-8.19": {
    environment: ["discovery.type=single-node", "xpack.security.enabled=false"],
    command: [
      "curl",
      "--fail",
      "--silent",
      "http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow"
    ]
  },
  "mssql-2022": {
    environment: ["ACCEPT_EULA=Y", "MSSQL_SA_PASSWORD=Devroost_test_2026!"],
    command: [
      "/opt/mssql-tools18/bin/sqlcmd",
      "-S",
      "localhost",
      "-U",
      "sa",
      "-P",
      "Devroost_test_2026!",
      "-C",
      "-Q",
      "SELECT 1"
    ]
  }
};

export function readinessProbe(name) {
  const probe = probes[name];
  if (!probe) throw new Error(`Mirror "${name}" has no readiness probe`);
  return {
    environment: [...probe.environment],
    command: [...probe.command]
  };
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function testMirror(name, reference, options = {}) {
  if (!reference) throw new Error("A mirror image reference is required");
  const probe = readinessProbe(name);
  const execute = options.execute ?? run;
  const attempts = options.attempts ?? 30;
  const interval = options.interval ?? 2_000;
  const reportCleanupError = options.reportCleanupError ?? console.warn;
  const containerName = `devroost-mirror-${name.replaceAll(/[^a-z0-9_.-]/g, "-")}-${process.pid}`;
  const environmentArgs = probe.environment.flatMap((value) => ["--env", value]);

  await execute("podman", [
    "run",
    "--detach",
    "--name",
    containerName,
    ...environmentArgs,
    reference
  ]);

  try {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await execute("podman", ["exec", containerName, ...probe.command]);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await pause(interval);
      }
    }
    throw new Error(`Mirror "${name}" did not become ready: ${lastError?.message}`);
  } finally {
    try {
      await execute("podman", ["rm", "--force", containerName]);
    } catch (error) {
      reportCleanupError(`Could not remove readiness container ${containerName}: ${error.message}`);
    }
  }
}

export async function main(args, dependencies = {}) {
  const [name, reference, ...rest] = args;
  if (!name || !reference || rest.length > 0) {
    throw new Error("Usage: test-mirror.mjs <catalog-name> <image-reference>");
  }
  const test = dependencies.test ?? testMirror;
  await test(name, reference, dependencies.options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
