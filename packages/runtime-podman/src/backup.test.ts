import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import { Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import type { DevroostService } from "@devroost/config";
import { backupServiceToFileWithDependencies, restoreServiceFromFileWithDependencies, REDIS_RESTORE_SCRIPT } from "./backup.js";

class FakeBackupProcess extends EventEmitter {
  stdout: { pipe: (target: Writable) => Writable };
  stderr = new EventEmitter();
  killed = false;

  constructor(writeToTarget: (target: Writable) => void) {
    super();
    this.stdout = {
      pipe: (target) => {
        writeToTarget(target);
        return target;
      }
    };
  }

  kill(): void {
    this.killed = true;
  }
}

class CollectingWritable extends Writable {
  chunks: string[] = [];

  override _write(
    chunk: string | Uint8Array,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    callback();
  }

  contents(): string {
    return this.chunks.join("");
  }
}

const postgresService: DevroostService = {
  type: "postgres",
  image: "postgres:16"
};

const mysqlService: DevroostService = {
  type: "mysql",
  image: "mysql:8.4"
};

const mariadbService: DevroostService = {
  type: "mariadb",
  image: "mariadb:11"
};

test("backupServiceToFile writes streamed backup output to disk", async () => {
  const child = new FakeBackupProcess((target) => {
    target.write("SELECT 1;\n");
    target.end();
  });
  const target = new CollectingWritable();

  const backupPromise = backupServiceToFileWithDependencies(
    "demo",
    "db",
    postgresService,
    "/tmp/backup.sql",
    {
      isContainerRunningByName: async () => true,
      makeDirectory: async () => undefined,
      createOutputStream: () => target,
      spawnBackupProcess: () => child
    }
  );

  setImmediate(() => {
    child.emit("close", 0);
  });

  await backupPromise;

  assert.equal(target.contents(), "SELECT 1;\n");
});

test("backupServiceToFile surfaces backup command failures", async () => {
  const child = new FakeBackupProcess((target) => {
    target.end();
  });
  const target = new CollectingWritable();

  const backupPromise = backupServiceToFileWithDependencies(
    "demo",
    "db",
    postgresService,
    "/tmp/backup.sql",
    {
      isContainerRunningByName: async () => true,
      makeDirectory: async () => undefined,
      createOutputStream: () => target,
      spawnBackupProcess: () => child
    }
  );

  setImmediate(() => {
    child.stderr.emit("data", Buffer.from("permission denied"));
    child.emit("close", 1);
  });

  await assert.rejects(() => backupPromise, /permission denied/i);
});

test("backupServiceToFile rejects when the service is not running", async () => {
  await assert.rejects(
    () =>
      backupServiceToFileWithDependencies(
        "demo",
        "db",
        postgresService,
        resolve("/tmp", "backup.sql"),
        {
          isContainerRunningByName: async () => false
        }
      ),
    /is not running/i
  );
});

test("restoreServiceFromFile copies the input file and runs the restore command", async () => {
  const commands: string[][] = [];

  await restoreServiceFromFileWithDependencies(
    "demo",
    "db",
    postgresService,
    "/tmp/backup.sql",
    {
      isContainerRunningByName: async () => true,
      ensureInputReadable: async () => undefined,
      prepareRestoreInput: async (_serviceType, inputPath) => ({ path: inputPath }),
      runPodmanCommand: async (args: string[]) => {
        commands.push(args);
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    }
  );

  assert.deepEqual(commands, [
    ["cp", "/tmp/backup.sql", "demo-db:/tmp/devroost-restore.sql"],
    ["exec", "demo-db", "sh", "-c", 'psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -f /tmp/devroost-restore.sql']
  ]);
});

test("restoreServiceFromFile uses mysql binary mode and password env vars", async () => {
  const commands: string[][] = [];

  await restoreServiceFromFileWithDependencies(
    "demo",
    "db",
    mysqlService,
    "/tmp/backup.sql",
    {
      isContainerRunningByName: async () => true,
      ensureInputReadable: async () => undefined,
      prepareRestoreInput: async (_serviceType, inputPath) => ({ path: inputPath }),
      runPodmanCommand: async (args: string[]) => {
        commands.push(args);
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    }
  );

  assert.deepEqual(commands, [
    ["cp", "/tmp/backup.sql", "demo-db:/tmp/devroost-restore.sql"],
    ["exec", "demo-db", "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --binary-mode=1 -h 127.0.0.1 -uroot "${MYSQL_DATABASE:-devroost}" < /tmp/devroost-restore.sql']
  ]);
});

test("restoreServiceFromFile uses mariadb binary mode and password env vars", async () => {
  const commands: string[][] = [];

  await restoreServiceFromFileWithDependencies(
    "demo",
    "db",
    mariadbService,
    "/tmp/backup.sql",
    {
      isContainerRunningByName: async () => true,
      ensureInputReadable: async () => undefined,
      prepareRestoreInput: async (_serviceType, inputPath) => ({ path: inputPath }),
      runPodmanCommand: async (args: string[]) => {
        commands.push(args);
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    }
  );

  assert.deepEqual(commands, [
    ["cp", "/tmp/backup.sql", "demo-db:/tmp/devroost-restore.sql"],
    ["exec", "demo-db", "sh", "-c", 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb --binary-mode=1 -h 127.0.0.1 -uroot "${MARIADB_DATABASE:-devroost}" < /tmp/devroost-restore.sql']
  ]);
});

test("restoreServiceFromFile copies sqlite backups directly into the data path", async () => {
  const commands: string[][] = [];

  await restoreServiceFromFileWithDependencies(
    "demo",
    "db",
    { type: "sqlite", image: "alpine:3.20" },
    "/tmp/devroost.db",
    {
      isContainerRunningByName: async () => true,
      ensureInputReadable: async () => undefined,
      prepareRestoreInput: async (_serviceType, inputPath) => ({ path: inputPath }),
      runPodmanCommand: async (args: string[]) => {
        commands.push(args);
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    }
  );

  assert.deepEqual(commands, [["cp", "/tmp/devroost.db", "demo-db:/data/devroost.db"]]);
});

test("restoreServiceFromFile rebuilds Redis AOF after staging the snapshot", async () => {
  const commands: string[][] = [];

  await restoreServiceFromFileWithDependencies(
    "demo",
    "db",
    { type: "redis", image: "redis:7" },
    "/tmp/dump.rdb",
    {
      isContainerRunningByName: async () => false,
      ensureInputReadable: async () => undefined,
      prepareRestoreInput: async (_serviceType, inputPath) => ({ path: inputPath }),
      runPodmanCommand: async (args: string[]) => {
        commands.push(args);
        return { ok: true, stdout: "", stderr: "", code: 0 };
      }
    }
  );

  assert.deepEqual(commands, [
    ["cp", "/tmp/dump.rdb", "demo-db:/data/.devroost-restore.rdb"],
    ["run", "--rm", "--network", "none", "--volumes-from", "demo-db", "--entrypoint", "sh", "docker.io/library/redis:7", "-c", REDIS_RESTORE_SCRIPT]
  ]);
});

test("restoreServiceFromFile surfaces copy failures", async () => {
  await assert.rejects(
    () =>
      restoreServiceFromFileWithDependencies(
        "demo",
        "db",
        postgresService,
        "/tmp/backup.sql",
        {
          isContainerRunningByName: async () => true,
          ensureInputReadable: async () => undefined,
          prepareRestoreInput: async (_serviceType, inputPath) => ({ path: inputPath }),
          runPodmanCommand: async () => ({ ok: false, stdout: "", stderr: "permission denied", code: 1 })
        }
      ),
    /permission denied/i
  );
});

test("restoreServiceFromFile rejects unsupported restore service types", async () => {
  await assert.rejects(
    () =>
      restoreServiceFromFileWithDependencies(
        "demo",
        "db",
        { type: "sqlserver", image: "mcr.microsoft.com/mssql/server:2022-latest" },
        "/tmp/devroost.bak",
        {
          isContainerRunningByName: async () => true,
          ensureInputReadable: async () => undefined,
          prepareRestoreInput: async (_serviceType, inputPath) => ({ path: inputPath }),
          runPodmanCommand: async () => ({ ok: true, stdout: "", stderr: "", code: 0 })
        }
      ),
    /does not currently support 'devroost restore'/i
  );
});

test("restoreServiceFromFile decompresses gzip-compressed mysql dumps before copying", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "devroost-runtime-restore-"));
  const inputPath = join(tempRoot, "backup.sql.gz");
  const commands: string[][] = [];

  await writeFile(inputPath, gzipSync("CREATE TABLE demo (id INT);\n"));

  try {
    await restoreServiceFromFileWithDependencies(
      "demo",
      "db",
      mysqlService,
      inputPath,
      {
        isContainerRunningByName: async () => true,
        runPodmanCommand: async (args: string[]) => {
          commands.push(args);
          return { ok: true, stdout: "", stderr: "", code: 0 };
        }
      }
    );

    assert.equal(commands[0]?.[0], "cp");
    assert.notEqual(commands[0]?.[1], inputPath);
    assert.match(commands[0]?.[1] ?? "", /backup\.sql$/);
    assert.deepEqual(commands[1], [
      "exec",
      "demo-db",
      "sh",
      "-c",
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --binary-mode=1 -h 127.0.0.1 -uroot "${MYSQL_DATABASE:-devroost}" < /tmp/devroost-restore.sql'
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("restoreServiceFromFile rejects xz-compressed mysql dumps with a helpful error", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "devroost-runtime-restore-"));
  const inputPath = join(tempRoot, "backup.sql.xz");

  await writeFile(inputPath, Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]));

  try {
    await assert.rejects(
      () =>
        restoreServiceFromFileWithDependencies(
          "demo",
          "db",
          mysqlService,
          inputPath,
          {
            isContainerRunningByName: async () => true,
            runPodmanCommand: async () => ({ ok: true, stdout: "", stderr: "", code: 0 })
          }
        ),
      /xz-compressed/i
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("PostgreSQL SQL errors propagate as failed restores", async () => {
  await assert.rejects(restoreServiceFromFileWithDependencies("demo", "db", postgresService, "/tmp/input.sql", {
    isContainerRunningByName: async () => true,
    ensureInputReadable: async () => {},
    prepareRestoreInput: async (_type, path) => ({ path }),
    runPodmanCommand: async (args) => args[0] === "cp"
      ? { ok: true, stdout: "", stderr: "", code: 0 }
      : { ok: false, stdout: "", stderr: "ERROR: invalid SQL", code: 3 }
  }), /invalid SQL/);
});

test("Redis restore refuses a running primary and reports helper failures", async () => {
  for (const running of [true, false]) {
    await assert.rejects(restoreServiceFromFileWithDependencies("demo", "db", { type: "redis", image: "redis:7" }, "/tmp/dump.rdb", {
      isContainerRunningByName: async () => running,
      ensureInputReadable: async () => {},
      prepareRestoreInput: async (_type, path) => ({ path }),
      runPodmanCommand: async (args) => args[0] === "cp"
        ? { ok: true, stdout: "", stderr: "", code: 0 }
        : { ok: false, stdout: "", stderr: "AOF rewrite failed", code: 1 }
    }), running ? /must be stopped/ : /AOF rewrite failed/);
  }
});
