import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCatalog, validateCatalog } from "./catalog.mjs";

const validCatalog = {
  schemaVersion: 1,
  registry: "ghcr.io/devroost-org",
  images: [
    {
      name: "devroost-php",
      kind: "custom",
      source: "docker.io/library/php:8.4.25-apache@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      version: "8.4.25-devroost.1",
      platforms: ["linux/amd64", "linux/arm64"],
      context: "images/php"
    }
  ]
};

function addDependentImage(catalog, overrides = {}) {
  catalog.images.push({
    name: "devroost-wordpress",
    kind: "custom",
    source: "docker.io/library/wordpress@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    runtime: "devroost-php",
    version: "6.8.3-php8.4-devroost.1",
    platforms: ["linux/amd64", "linux/arm64"],
    context: "images/wordpress",
    ...overrides
  });
}

test("accepts a complete Devroost image catalog", () => {
  assert.deepEqual(validateCatalog(validCatalog), []);
});

test("rejects duplicate image names", () => {
  const catalog = structuredClone(validCatalog);
  catalog.images.push(structuredClone(catalog.images[0]));

  assert.deepEqual(validateCatalog(catalog), [
    'images contains duplicate name "devroost-php"'
  ]);
});

test("rejects catalog entries that cannot produce immutable Devroost images", () => {
  const catalog = structuredClone(validCatalog);
  catalog.registry = "docker.io/example";
  catalog.images[0].source = "docker.io/library/php:8.4-apache";
  catalog.images[0].platforms = ["linux/amd64"];
  delete catalog.images[0].context;

  assert.deepEqual(validateCatalog(catalog), [
    'registry must be "ghcr.io/devroost-org"',
    'image "devroost-php" source must include an immutable sha256 digest',
    'image "devroost-php" must support linux/amd64 and linux/arm64',
    'custom image "devroost-php" must define a relative context under images/'
  ]);
});

test("loads a valid catalog from disk", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "devroost-image-catalog-"));
  const catalogPath = path.join(directory, "catalog.json");
  await writeFile(catalogPath, JSON.stringify(validCatalog));

  assert.deepEqual(await loadCatalog(catalogPath), validCatalog);
});

test("repository catalog covers every approved runtime and mirror", async () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  const catalog = await loadCatalog(path.join(repositoryRoot, "images/catalog.json"));

  assert.deepEqual(
    catalog.images.map(({ name }) => name),
    [
      "devroost-php",
      "devroost-wordpress",
      "devroost-node-22",
      "devroost-node-24",
      "devroost-python-3.12",
      "devroost-ruby-3.3",
      "devroost-bun-1",
      "devroost-java-21",
      "devroost-dotnet-8",
      "devroost-sqlite-3",
      "postgres-16",
      "mysql-8.4",
      "mariadb-11.8",
      "redis-7.4",
      "mongo-7.0",
      "elasticsearch-8.19",
      "mssql-2022"
    ]
  );
});

test("reports an invalid catalog document instead of throwing", () => {
  assert.deepEqual(validateCatalog(null), ["catalog must be an object"]);
  assert.deepEqual(validateCatalog({}), [
    "schemaVersion must be 1",
    'registry must be "ghcr.io/devroost-org"',
    "images must be an array"
  ]);
});

test("reports malformed image entry fields", () => {
  const catalog = {
    schemaVersion: 1,
    registry: "ghcr.io/devroost-org",
    images: [
      {
        name: "Bad Name",
        kind: "copy",
        source: 42,
        version: "",
        platforms: "linux/amd64",
        context: "../outside"
      }
    ]
  };

  assert.deepEqual(validateCatalog(catalog), [
    'image at index 0 has invalid name "Bad Name"',
    'image "Bad Name" kind must be custom or mirror',
    'image "Bad Name" source must include an immutable sha256 digest',
    'image "Bad Name" must define a non-empty version',
    'image "Bad Name" platforms must be an array'
  ]);
});

test("requires a reason when an upstream mirror lacks ARM64", () => {
  const catalog = structuredClone(validCatalog);
  catalog.images[0] = {
    name: "mssql-2022",
    kind: "mirror",
    source: "mcr.microsoft.com/mssql/server:2022@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    version: "2022",
    platforms: ["linux/amd64"]
  };

  assert.deepEqual(validateCatalog(catalog), [
    'mirror "mssql-2022" without linux/arm64 must define platformLimit'
  ]);
});

test("rejects a missing custom runtime dependency", () => {
  const catalog = structuredClone(validCatalog);
  addDependentImage(catalog, { runtime: "missing" });

  assert.deepEqual(validateCatalog(catalog), [
    'image "devroost-wordpress" runtime "missing" does not exist'
  ]);
});

test("rejects malformed, mirrored, and platform-incompatible runtimes", () => {
  const malformed = structuredClone(validCatalog);
  addDependentImage(malformed, { runtime: "Bad Runtime" });
  assert.deepEqual(validateCatalog(malformed), [
    'image "devroost-wordpress" has invalid runtime "Bad Runtime"'
  ]);

  const mirrored = structuredClone(validCatalog);
  mirrored.images.push({
    name: "postgres-16",
    kind: "mirror",
    source: "docker.io/library/postgres@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    version: "16",
    platforms: ["linux/amd64", "linux/arm64"]
  });
  addDependentImage(mirrored, { runtime: "postgres-16" });
  assert.deepEqual(validateCatalog(mirrored), [
    'image "devroost-wordpress" runtime "postgres-16" must be custom'
  ]);

  const incompatible = structuredClone(validCatalog);
  incompatible.images[0].platforms = ["linux/amd64"];
  addDependentImage(incompatible);
  assert.deepEqual(validateCatalog(incompatible), [
    'image "devroost-php" must support linux/amd64 and linux/arm64',
    'image "devroost-wordpress" platform "linux/arm64" is not supported by runtime "devroost-php"'
  ]);
});

test("accepts an acyclic runtime and rejects dependency cycles", () => {
  const acyclic = structuredClone(validCatalog);
  addDependentImage(acyclic);
  assert.deepEqual(validateCatalog(acyclic), []);

  const cyclic = structuredClone(acyclic);
  cyclic.images[0].runtime = "devroost-wordpress";
  assert.deepEqual(validateCatalog(cyclic), [
    "image runtime dependency cycle: devroost-php -> devroost-wordpress -> devroost-php"
  ]);
});
