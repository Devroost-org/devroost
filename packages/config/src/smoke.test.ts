import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLoomConfig, loadLoomProject } from "./index.js";

test("config exports are available", () => {
  assert.equal(typeof loadLoomConfig, "function");
  assert.equal(typeof loadLoomProject, "function");
});

test("loadLoomProject resolves config from parent directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-config-"));
  const nested = join(root, "a", "b");
  await mkdir(nested, { recursive: true });

  const configPath = join(root, "devroost.yaml");
  await writeFile(
    configPath,
    [
      "version: 1",
      "name: test-project",
      "runtime:",
      "  engine: podman",
      "  rootless: true",
      "services:",
      "  app:",
      "    type: node",
      "    image: node:20-alpine"
    ].join("\n"),
    "utf8"
  );

  const previousCwd = process.cwd();
  process.chdir(nested);
  try {
    const loaded = await loadLoomProject();
    assert.equal(loaded.config.name, "test-project");
    assert.equal(loaded.projectRoot, root);
  } finally {
    process.chdir(previousCwd);
  }
});

test("loadLoomProject rejects unsafe service names", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-config-invalid-service-"));
  const configPath = join(root, "devroost.yaml");

  await writeFile(
    configPath,
    [
      "version: 1",
      "name: test-project",
      "runtime:",
      "  engine: podman",
      "services:",
      "  bad service:",
      "    type: node",
      "    image: node:20-alpine"
    ].join("\n"),
    "utf8"
  );

  await assert.rejects(() => loadLoomProject(configPath), /Service names must start with an alphanumeric character/i);
});

test("loadLoomProject rejects invalid route host", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-config-invalid-host-"));
  const configPath = join(root, "devroost.yaml");

  await writeFile(
    configPath,
    [
      "version: 1",
      "name: test-project",
      "runtime:",
      "  engine: podman",
      "services:",
      "  app:",
      "    type: node",
      "    image: node:20-alpine",
      "routes:",
      "  - host: bad host",
      "    service: app",
      "    port: 3000"
    ].join("\n"),
    "utf8"
  );

  await assert.rejects(() => loadLoomProject(configPath), /Route host must be a valid hostname/i);
});

test("loadLoomProject interpolates image strings from .env with defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-config-env-"));
  const configPath = join(root, "devroost.yaml");
  const envPath = join(root, ".env");

  await writeFile(envPath, ["APP_IMAGE=node:22-alpine"].join("\n"), "utf8");
  await writeFile(
    configPath,
    [
      "version: 1",
      "name: test-project",
      "runtime:",
      "  engine: podman",
      "  rootless: true",
      "services:",
      "  app:",
      "    type: node",
      "    image: ${APP_IMAGE:-node:24-alpine}",
      "  cache:",
      "    type: redis",
      "    image: ${CACHE_IMAGE:-redis:7-alpine}"
    ].join("\n"),
    "utf8"
  );

  const loaded = await loadLoomProject(configPath);
  assert.equal(loaded.config.services.app.image, "node:22-alpine");
  assert.equal(loaded.config.services.cache.image, "redis:7-alpine");
});

test("loadLoomProject interpolates service user fields from .env", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-config-user-env-"));
  const configPath = join(root, "devroost.yaml");
  const envPath = join(root, ".env");

  await writeFile(envPath, ["HOST_UID=1001", "HOST_GID=1002"].join("\n"), "utf8");
  await writeFile(
    configPath,
    [
      "version: 1",
      "name: test-project",
      "runtime:",
      "  engine: podman",
      "  rootless: true",
      "services:",
      "  app:",
      "    type: node",
      "    image: node:20-alpine",
      "    user: ${HOST_UID:-1000}:${HOST_GID:-1000}",
      "    execUser: ${HOST_UID:-1000}:${HOST_GID:-1000}",
      "    userns: keep-id"
    ].join("\n"),
    "utf8"
  );

  const loaded = await loadLoomProject(configPath);
  assert.equal(loaded.config.services.app.user, "1001:1002");
  assert.equal(loaded.config.services.app.execUser, "1001:1002");
  assert.equal(loaded.config.services.app.userns, "keep-id");
});

test("loadLoomProject reads optional php composer startup toggle", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-config-composer-"));
  const configPath = join(root, "devroost.yaml");

  await writeFile(
    configPath,
    [
      "version: 1",
      "name: test-project",
      "runtime:",
      "  engine: podman",
      "  rootless: true",
      "services:",
      "  app:",
      "    type: php",
      "    image: php:8.3-apache",
      "    composer: false"
    ].join("\n"),
    "utf8"
  );

  const loaded = await loadLoomProject(configPath);
  assert.equal(loaded.config.services.app.composer, false);
});

test("loadLoomProject throws when an interpolated variable is missing and has no default", async () => {
  const root = await mkdtemp(join(tmpdir(), "loom-config-missing-env-"));
  const configPath = join(root, "devroost.yaml");

  await writeFile(
    configPath,
    [
      "version: 1",
      "name: test-project",
      "runtime:",
      "  engine: podman",
      "  rootless: true",
      "services:",
      "  app:",
      "    type: node",
      "    image: ${APP_IMAGE}"
    ].join("\n"),
    "utf8"
  );

  await assert.rejects(() => loadLoomProject(configPath), /Missing required environment variable 'APP_IMAGE'/i);
});
