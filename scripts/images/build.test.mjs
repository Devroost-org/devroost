import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "./catalog.mjs";
import { buildImage, main } from "./build.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

const catalog = await loadCatalog(path.join(repositoryRoot, "images/catalog.json"));
const php = catalog.images.find(({ name }) => name === "loom-php");
const wordpress = catalog.images.find(({ name }) => name === "loom-wordpress");
const phpReference = `localhost/${php.name}:${php.version}`;
const wordpressReference = `localhost/${wordpress.name}:${wordpress.version}`;

test("builds a custom catalog image with an argument-array invocation", async () => {
  const calls = [];
  const reference = await buildImage("loom-php", {
    catalogPath: path.join(repositoryRoot, "images/catalog.json"),
    platform: "linux/amd64",
    execute: async (command, args, options) => {
      calls.push({ command, args, options });
    }
  });

  assert.equal(reference, phpReference);
  assert.deepEqual(calls, [
    {
      command: "podman",
      args: [
        "build",
        "--platform",
        "linux/amd64",
        "--build-arg",
        `LOOM_BASE_IMAGE=${php.source}`,
        "--file",
        path.join(repositoryRoot, "images/php/Containerfile"),
        "--tag",
        phpReference,
        path.join(repositoryRoot, "images/php")
      ],
      options: { cwd: repositoryRoot }
    }
  ]);
});

test("builds a runtime dependency before its dependent image", async () => {
  const calls = [];
  const reference = await buildImage("loom-wordpress", {
    catalogPath: path.join(repositoryRoot, "images/catalog.json"),
    platform: "linux/amd64",
    execute: async (command, args, options) => {
      calls.push({ command, args, options });
    }
  });

  assert.equal(reference, wordpressReference);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.at(-2), phpReference);
  assert.deepEqual(
    calls[1].args.filter((argument) => argument.startsWith("LOOM_")),
    [
      `LOOM_BASE_IMAGE=${phpReference}`,
      `LOOM_SOURCE_IMAGE=${wordpress.source}`
    ]
  );
  assert.equal(
    calls[1].args.at(-2),
    wordpressReference
  );
});

test("stops when a runtime dependency build fails", async () => {
  const failure = new Error("runtime build failed");
  const calls = [];

  await assert.rejects(
    buildImage("loom-wordpress", {
      catalogPath: path.join(repositoryRoot, "images/catalog.json"),
      execute: async (command, args) => {
        calls.push({ command, args });
        throw failure;
      }
    }),
    (error) => error === failure
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(-2), phpReference);
});

test("CLI accepts an image name and platform", async () => {
  const calls = [];
  await main(["loom-node-24", "--platform", "linux/arm64"], {
    build: async (name, options) => calls.push({ name, options })
  });

  assert.deepEqual(calls, [
    {
      name: "loom-node-24",
      options: { platform: "linux/arm64" }
    }
  ]);
});

test("rejects unknown, mirrored, and unsupported build requests", async () => {
  const catalogPath = path.join(repositoryRoot, "images/catalog.json");
  await assert.rejects(
    buildImage("missing", { catalogPath, execute: async () => {} }),
    /Unknown image "missing"/
  );
  await assert.rejects(
    buildImage("postgres-16", { catalogPath, execute: async () => {} }),
    /is a mirror and cannot be built/
  );
  await assert.rejects(
    buildImage("loom-php", {
      catalogPath,
      platform: "linux/s390x",
      execute: async () => {}
    }),
    /does not support linux\/s390x/
  );
});
