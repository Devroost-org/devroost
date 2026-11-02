import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Writable } from "node:stream";
import { createGunzip } from "node:zlib";
import type { DevroostService } from "@devroost/config";
import { assertContainerOwnership, containerName, isContainerRunning, normalizeImage } from "./containers.js";
import { runPodman } from "./podman.js";

export interface BackupStrategy {
  extension: string;
  command: string[];
}

interface BackupChildProcess {
  stdout: {
    pipe: (target: Writable) => Writable;
  };
  stderr: {
    on(event: "data", listener: (chunk: string | Uint8Array) => void): unknown;
  };
  on(event: "error", listener: () => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(): void;
}

// Load the snapshot without the old AOF, then let Redis regenerate its own AOF.
// The primary container stays stopped until this helper completes successfully.
export const REDIS_RESTORE_SCRIPT = `set -eu
redis-check-rdb /data/.devroost-restore.rdb
mv /data/.devroost-restore.rdb /data/dump.rdb
restore_dir=$(mktemp -d)
socket="$restore_dir/redis.sock"
redis_pid=""
cleanup() {
  if [ -n "$redis_pid" ]; then
    redis-cli -s "$socket" shutdown nosave >/dev/null 2>&1 || kill "$redis_pid" 2>/dev/null || true
    wait "$redis_pid" 2>/dev/null || true
  fi
  rm -rf "$restore_dir"
}
trap cleanup EXIT
redis-server --dir /data --dbfilename dump.rdb --appendonly no --save "" --port 0 --unixsocket "$socket" >"$restore_dir/redis.log" 2>&1 &
redis_pid=$!
ready=false
for attempt in $(seq 1 120); do
  if redis-cli -s "$socket" ping 2>/dev/null | grep -q PONG; then ready=true; break; fi
  if ! kill -0 "$redis_pid" 2>/dev/null; then cat "$restore_dir/redis.log" >&2; exit 1; fi
  sleep 1
done
if [ "$ready" != true ]; then echo "Redis restore startup timed out" >&2; exit 1; fi
redis-cli -s "$socket" config set appendonly yes | grep -q '^OK$'
for attempt in $(seq 1 120); do
  info=$(redis-cli -s "$socket" info persistence | tr -d '\r')
  if printf '%s\n' "$info" | grep -q '^aof_rewrite_in_progress:0$' &&
     printf '%s\n' "$info" | grep -q '^aof_rewrite_scheduled:0$'; then
    printf '%s\n' "$info" | grep -q '^aof_last_bgrewrite_status:ok$'
    redis-cli -s "$socket" shutdown nosave
    wait "$redis_pid"
    redis_pid=""
    exit 0
  fi
  sleep 1
done
echo "Redis append-only rewrite timed out" >&2
exit 1
`;

interface BackupDependencies {
  isContainerRunningByName?: (name: string) => Promise<boolean>;
  makeDirectory?: (path: string, options: { recursive: boolean }) => Promise<unknown>;
  createOutputStream?: (path: string) => Writable;
  spawnBackupProcess?: (containerNameValue: string, command: string[]) => BackupChildProcess;
}

interface RestoreDependencies {
  isContainerRunningByName?: (name: string) => Promise<boolean>;
  ensureInputReadable?: (path: string) => Promise<void>;
  prepareRestoreInput?: (serviceType: string, inputPath: string) => Promise<PreparedRestoreInput>;
  runPodmanCommand?: (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string; code: number }>;
}

interface PreparedRestoreInput {
  path: string;
  cleanup?: () => Promise<void>;
}

export const SUPPORTED_BACKUP_SERVICE_TYPES = [
  "mysql",
  "mariadb",
  "postgres",
  "mongodb",
  "redis",
  "sqlite",
  "sqlserver"
] as const;

export const SUPPORTED_RESTORE_SERVICE_TYPES = [
  "mysql",
  "mariadb",
  "postgres",
  "mongodb",
  "redis",
  "sqlite"
] as const;

export function databaseBackupStrategy(serviceType: string): BackupStrategy | null {
  const normalized = serviceType.toLowerCase();

  if (normalized === "mysql") {
    return {
      extension: "sql",
      command: [
        "sh",
        "-c",
        "mysqldump -h 127.0.0.1 -uroot -p\"$MYSQL_ROOT_PASSWORD\" \"${MYSQL_DATABASE:-devroost}\""
      ]
    };
  }

  if (normalized === "mariadb") {
    return {
      extension: "sql",
      command: [
        "sh",
        "-c",
        "mariadb-dump -h 127.0.0.1 -uroot -p\"$MARIADB_ROOT_PASSWORD\" \"${MARIADB_DATABASE:-devroost}\""
      ]
    };
  }

  if (normalized === "postgres") {
    return {
      extension: "sql",
      command: ["sh", "-c", "pg_dump -U \"${POSTGRES_USER:-postgres}\" \"${POSTGRES_DB:-postgres}\""]
    };
  }

  if (normalized === "mongodb") {
    return {
      extension: "archive.gz",
      command: [
        "sh",
        "-c",
        "mongodump --archive --gzip --authenticationDatabase admin --username \"${MONGO_INITDB_ROOT_USERNAME:-root}\" --password \"${MONGO_INITDB_ROOT_PASSWORD:-example}\" --db \"${MONGO_INITDB_DATABASE:-admin}\""
      ]
    };
  }

  if (normalized === "redis") {
    return {
      extension: "rdb",
      command: ["sh", "-c", "redis-cli SAVE >/dev/null && cat /data/dump.rdb"]
    };
  }

  if (normalized === "sqlite") {
    return {
      extension: "db",
      command: ["sh", "-c", `snapshot=$(mktemp /tmp/devroost-sqlite-backup.XXXXXX); trap 'rm -f "$snapshot"' EXIT; sqlite3 -cmd '.timeout 5000' /data/devroost.db ".backup '$snapshot'" && cat "$snapshot"`]
    };
  }

  if (normalized === "sqlserver" || normalized === "mssql") {
    return {
      extension: "bak",
      command: [
        "sh",
        "-c",
        "mkdir -p /var/opt/mssql/backup && /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P \"$MSSQL_SA_PASSWORD\" -Q \"BACKUP DATABASE [master] TO DISK='/var/opt/mssql/backup/devroost.bak' WITH INIT\" >/dev/null && cat /var/opt/mssql/backup/devroost.bak"
      ]
    };
  }

  return null;
}

export function backupExtensionForServiceType(serviceType: string): string | null {
  return databaseBackupStrategy(serviceType)?.extension ?? null;
}

interface RestoreStrategy {
  destinationPath: string;
  command?: string[];
}

function requiresTextSqlRestore(serviceType: string): boolean {
  return ["mysql", "mariadb", "postgres"].includes(serviceType.toLowerCase());
}

async function readInputPrefix(inputPath: string, bytes = 64): Promise<Buffer> {
  const handle = await open(inputPath, "r");

  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectRestoreInputFormat(prefix: Buffer): "gzip" | "xz" | "zip" | "binary" | "text" {
  if (prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b) {
    return "gzip";
  }

  if (
    prefix.length >= 6 &&
    prefix[0] === 0xfd &&
    prefix[1] === 0x37 &&
    prefix[2] === 0x7a &&
    prefix[3] === 0x58 &&
    prefix[4] === 0x5a &&
    prefix[5] === 0x00
  ) {
    return "xz";
  }

  if (
    prefix.length >= 4 &&
    prefix[0] === 0x50 &&
    prefix[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(prefix[2] ?? -1) &&
    [0x04, 0x06, 0x08].includes(prefix[3] ?? -1)
  ) {
    return "zip";
  }

  if (prefix.includes(0x00)) {
    return "binary";
  }

  return "text";
}

async function gunzipRestoreInput(inputPath: string): Promise<PreparedRestoreInput> {
  const tempDir = await mkdtemp(join(tmpdir(), "devroost-restore-"));
  const outputName = basename(inputPath).replace(/\.gz$/i, "") || "devroost-restore.sql";
  const outputPath = join(tempDir, outputName);

  await pipeline(createReadStream(inputPath), createGunzip(), createWriteStream(outputPath));

  return {
    path: outputPath,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function prepareRestoreInputForService(serviceType: string, inputPath: string): Promise<PreparedRestoreInput> {
  if (!requiresTextSqlRestore(serviceType)) {
    return { path: inputPath };
  }

  const prefix = await readInputPrefix(inputPath);
  const format = detectRestoreInputFormat(prefix);

  if (format === "gzip") {
    return gunzipRestoreInput(inputPath);
  }

  if (format === "xz") {
    throw new Error(
      `Restore input '${inputPath}' appears to be xz-compressed. Devroost restore currently supports plain SQL dumps and gzip-compressed SQL dumps for ${serviceType}. Decompress the file first.`
    );
  }

  if (format === "zip") {
    throw new Error(
      `Restore input '${inputPath}' appears to be a zip archive. Devroost restore currently supports plain SQL dumps and gzip-compressed SQL dumps for ${serviceType}. Extract the SQL file first.`
    );
  }

  if (format === "binary") {
    throw new Error(
      `Restore input '${inputPath}' does not look like a plain SQL dump. Devroost restore currently supports plain SQL dumps and gzip-compressed SQL dumps for ${serviceType}.`
    );
  }

  return { path: inputPath };
}

export function databaseRestoreStrategy(serviceType: string): RestoreStrategy | null {
  const normalized = serviceType.toLowerCase();

  if (normalized === "mysql") {
    return {
      destinationPath: "/tmp/devroost-restore.sql",
      command: [
        "sh",
        "-c",
        "MYSQL_PWD=\"$MYSQL_ROOT_PASSWORD\" mysql --binary-mode=1 -h 127.0.0.1 -uroot \"${MYSQL_DATABASE:-devroost}\" < /tmp/devroost-restore.sql"
      ]
    };
  }

  if (normalized === "mariadb") {
    return {
      destinationPath: "/tmp/devroost-restore.sql",
      command: [
        "sh",
        "-c",
        "MYSQL_PWD=\"$MARIADB_ROOT_PASSWORD\" mariadb --binary-mode=1 -h 127.0.0.1 -uroot \"${MARIADB_DATABASE:-devroost}\" < /tmp/devroost-restore.sql"
      ]
    };
  }

  if (normalized === "postgres") {
    return {
      destinationPath: "/tmp/devroost-restore.sql",
      command: [
        "sh",
        "-c",
        "psql -v ON_ERROR_STOP=1 -U \"${POSTGRES_USER:-postgres}\" -d \"${POSTGRES_DB:-postgres}\" -f /tmp/devroost-restore.sql"
      ]
    };
  }

  if (normalized === "mongodb") {
    return {
      destinationPath: "/tmp/devroost-restore.archive.gz",
      command: [
        "sh",
        "-c",
        "mongorestore --drop --archive=/tmp/devroost-restore.archive.gz --gzip --authenticationDatabase admin --username \"${MONGO_INITDB_ROOT_USERNAME:-root}\" --password \"${MONGO_INITDB_ROOT_PASSWORD:-example}\" --db \"${MONGO_INITDB_DATABASE:-admin}\""
      ]
    };
  }

  if (normalized === "redis") {
    return {
      destinationPath: "/data/.devroost-restore.rdb"
    };
  }

  if (normalized === "sqlite") {
    return {
      destinationPath: "/data/devroost.db"
    };
  }

  return null;
}

export function restoreSupportedForServiceType(serviceType: string): boolean {
  return databaseRestoreStrategy(serviceType) !== null;
}

export async function backupServiceToFile(
  projectName: string,
  serviceName: string,
  service: DevroostService,
  outputPath: string
): Promise<void> {
  await assertContainerOwnership(projectName, containerName(projectName, serviceName));
  return backupServiceToFileWithDependencies(projectName, serviceName, service, outputPath);
}

export async function backupServiceToFileWithDependencies(
  projectName: string,
  serviceName: string,
  service: DevroostService,
  outputPath: string,
  dependencies: BackupDependencies = {}
): Promise<void> {
  const strategy = databaseBackupStrategy(service.type);
  if (!strategy) {
    throw new Error(
      `Service type '${service.type}' does not currently support 'devroost backup'. Supported types: mysql, mariadb, postgres, mongodb, redis, sqlite, sqlserver.`
    );
  }

  const name = containerName(projectName, serviceName);
  const isContainerRunningByName = dependencies.isContainerRunningByName ?? isContainerRunning;
  const makeDirectory = dependencies.makeDirectory ?? mkdir;
  const createOutputStream = dependencies.createOutputStream ?? createWriteStream;
  const spawnBackupProcess =
    dependencies.spawnBackupProcess ??
    ((containerNameValue: string, command: string[]) =>
      spawn("podman", ["exec", "-i", containerNameValue, ...command], {
        stdio: ["ignore", "pipe", "pipe"]
      }));
  const running = await isContainerRunningByName(name);
  if (!running) {
    throw new Error(`Service '${serviceName}' is not running. Start it before creating a backup.`);
  }

  await makeDirectory(dirname(outputPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawnBackupProcess(name, strategy.command);
    const target = createOutputStream(outputPath);
    let stderr = "";
    let childExited = false;
    let streamFinished = false;
    let completed = false;

    const finish = (error?: Error) => {
      if (completed) {
        return;
      }

      completed = true;

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const maybeResolve = () => {
      if (childExited && streamFinished) {
        finish();
      }
    };

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      target.destroy();
      finish(new Error(`Failed to run backup command for '${serviceName}'.`));
    });

    target.on("error", () => {
      child.kill();
      finish(new Error(`Failed to write backup file '${outputPath}'.`));
    });

    target.on("finish", () => {
      streamFinished = true;
      maybeResolve();
    });

    child.stdout.pipe(target);

    child.on("close", (code) => {
      if (code === 0) {
        childExited = true;
        maybeResolve();
        return;
      }

      finish(
        new Error(
          `Backup failed for service '${serviceName}': ${stderr.trim() || "unknown error"}`
        )
      );
    });
  });
}

export async function restoreServiceFromFile(
  projectName: string,
  serviceName: string,
  service: DevroostService,
  inputPath: string
): Promise<void> {
  await assertContainerOwnership(projectName, containerName(projectName, serviceName));
  return restoreServiceFromFileWithDependencies(projectName, serviceName, service, inputPath);
}

export async function restoreServiceFromFileWithDependencies(
  projectName: string,
  serviceName: string,
  service: DevroostService,
  inputPath: string,
  dependencies: RestoreDependencies = {}
): Promise<void> {
  const strategy = databaseRestoreStrategy(service.type);
  if (!strategy) {
    throw new Error(
      `Service type '${service.type}' does not currently support 'devroost restore'. Supported types: ${SUPPORTED_RESTORE_SERVICE_TYPES.join(", ")}.`
    );
  }

  const name = containerName(projectName, serviceName);
  const isContainerRunningByName = dependencies.isContainerRunningByName ?? isContainerRunning;
  const ensureInputReadable = dependencies.ensureInputReadable ?? ((path: string) => access(path, constants.R_OK));
  const prepareRestoreInput = dependencies.prepareRestoreInput ?? prepareRestoreInputForService;
  const runPodmanCommand = dependencies.runPodmanCommand ?? runPodman;

  const running = await isContainerRunningByName(name);
  if (service.type.toLowerCase() === "redis" && running) {
    throw new Error(`Service '${serviceName}' must be stopped before restoring Redis.`);
  }
  if (strategy.command && !running) {
    throw new Error(`Service '${serviceName}' is not running. Start it before restoring a backup.`);
  }

  await ensureInputReadable(inputPath);

  const preparedInput = await prepareRestoreInput(service.type, inputPath);

  try {
    const copyResult = await runPodmanCommand(["cp", preparedInput.path, `${name}:${strategy.destinationPath}`]);
    if (!copyResult.ok) {
      throw new Error(
        `Restore failed for service '${serviceName}' while copying '${inputPath}' into the container: ${copyResult.stderr || copyResult.stdout || "unknown error"}`
      );
    }

    if (service.type.toLowerCase() === "redis") {
      const result = await runPodmanCommand([
        "run", "--rm", "--network", "none", "--volumes-from", name,
        "--entrypoint", "sh", normalizeImage(service.image), "-c", REDIS_RESTORE_SCRIPT
      ]);
      if (!result.ok) {
        throw new Error(`Redis restore failed for '${serviceName}': ${result.stderr || result.stdout || "unknown error"}`);
      }
      return;
    }

    if (!strategy.command) {
      return;
    }

    const restoreResult = await runPodmanCommand(["exec", name, ...strategy.command]);
    if (!restoreResult.ok) {
      throw new Error(
        `Restore failed for service '${serviceName}': ${restoreResult.stderr || restoreResult.stdout || "unknown error"}`
      );
    }
  } finally {
    await preparedInput.cleanup?.();
  }
}
