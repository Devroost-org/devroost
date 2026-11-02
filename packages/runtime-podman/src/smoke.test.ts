import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_BACKUP_SERVICE_TYPES,
  SUPPORTED_RESTORE_SERVICE_TYPES,
  backupExtensionForServiceType,
  buildExecArgs,
  containerName
} from "./index.js";
import { restoreSupportedForServiceType } from "./backup.js";

test("runtime exports are available", () => {
  assert.equal(containerName("proj", "svc"), "proj-svc");
  assert.ok(SUPPORTED_BACKUP_SERVICE_TYPES.length > 0);
  assert.ok(SUPPORTED_RESTORE_SERVICE_TYPES.length > 0);
});

test("backup extension mapping handles supported and unsupported service types", () => {
  assert.equal(backupExtensionForServiceType("postgres"), "sql");
  assert.equal(backupExtensionForServiceType("mongodb"), "archive.gz");
  assert.equal(backupExtensionForServiceType("not-a-db"), null);
});

test("restore support mapping handles supported and unsupported service types", () => {
  assert.equal(restoreSupportedForServiceType("postgres"), true);
  assert.equal(restoreSupportedForServiceType("sqlite"), true);
  assert.equal(restoreSupportedForServiceType("redis"), true);
  assert.equal(restoreSupportedForServiceType("sqlserver"), false);
});

test("buildExecArgs includes tty flags for interactive terminal", () => {
  const args = buildExecArgs("demo-app", ["node", "-v"], true);
  assert.deepEqual(args, ["exec", "-it", "demo-app", "node", "-v"]);
});

test("buildExecArgs includes exec user when provided", () => {
  const args = buildExecArgs("demo-app", ["id"], true, "1000:1000", "/workspace");
  assert.deepEqual(args, [
    "exec",
    "-it",
    "-w",
    "/workspace",
    "--user",
    "1000:1000",
    "demo-app",
    "id"
  ]);
});

test("buildExecArgs falls back to podman --user for non uid-gid exec users", () => {
  const args = buildExecArgs("demo-app", ["id"], false, "node", "/workspace");
  assert.deepEqual(args, ["exec", "-w", "/workspace", "--user", "node", "demo-app", "id"]);
});

test("buildExecArgs omits tty flags for non-interactive terminal", () => {
  const args = buildExecArgs("demo-app", ["node", "-v"], false);
  assert.deepEqual(args, ["exec", "demo-app", "node", "-v"]);
});

test("buildExecArgs rejects empty command", () => {
  assert.throws(() => buildExecArgs("demo-app", [], false), /Command required for devroost exec/i);
});
