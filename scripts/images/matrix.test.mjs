import assert from "node:assert/strict";
import test from "node:test";

import { createBuildMatrix, createMirrorMatrix } from "./matrix.mjs";

const catalog = {
  registry: "ghcr.io/devroost-org",
  images: [
    {
      name: "z-mirror",
      kind: "mirror",
      source: `docker.io/example/z@sha256:${"a".repeat(64)}`,
      version: "1.0",
      platforms: ["linux/arm64", "linux/amd64"]
    },
    {
      name: "b-runtime",
      kind: "custom",
      source: `docker.io/example/b@sha256:${"b".repeat(64)}`,
      version: "2.0-devroost.1",
      platforms: ["linux/arm64", "linux/amd64"],
      context: "images/b"
    },
    {
      name: "a-runtime",
      kind: "custom",
      source: `docker.io/example/a@sha256:${"c".repeat(64)}`,
      version: "1.0-devroost.1",
      platforms: ["linux/amd64", "linux/arm64"],
      context: "images/a"
    }
  ]
};

test("creates stable per-platform matrices separated by image kind", () => {
  assert.deepEqual(createBuildMatrix(catalog), [
    {
      name: "a-runtime",
      platform: "linux/amd64",
      context: "images/a",
      version: "1.0-devroost.1"
    },
    {
      name: "a-runtime",
      platform: "linux/arm64",
      context: "images/a",
      version: "1.0-devroost.1"
    },
    {
      name: "b-runtime",
      platform: "linux/amd64",
      context: "images/b",
      version: "2.0-devroost.1"
    },
    {
      name: "b-runtime",
      platform: "linux/arm64",
      context: "images/b",
      version: "2.0-devroost.1"
    }
  ]);

  assert.deepEqual(createMirrorMatrix(catalog), [
    {
      name: "z-mirror",
      platform: "linux/amd64",
      source: `docker.io/example/z@sha256:${"a".repeat(64)}`,
      version: "1.0"
    },
    {
      name: "z-mirror",
      platform: "linux/arm64",
      source: `docker.io/example/z@sha256:${"a".repeat(64)}`,
      version: "1.0"
    }
  ]);
});

test("filters by requested names and rejects unknown names", () => {
  assert.deepEqual(
    createBuildMatrix(catalog, ["b-runtime"]).map(({ name, platform }) => ({ name, platform })),
    [
      { name: "b-runtime", platform: "linux/amd64" },
      { name: "b-runtime", platform: "linux/arm64" }
    ]
  );
  assert.throws(
    () => createMirrorMatrix(catalog, ["missing"]),
    /Unknown image "missing"/
  );
});
