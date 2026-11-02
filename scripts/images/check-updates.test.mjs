import assert from "node:assert/strict";
import test from "node:test";

import { applyCatalogUpdates, checkCatalogUpdates } from "./check-updates.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const catalog = {
  schemaVersion: 1,
  registry: "ghcr.io/devroost-org",
  images: [
    {
      name: "devroost-node-24",
      kind: "custom",
      source: `docker.io/library/node:24.20.0-alpine@${digest("a")}`,
      version: "24.20.0-devroost.3",
      platforms: ["linux/amd64", "linux/arm64"],
      context: "images/node"
    }
  ]
};

test("leaves catalog bytes unchanged when registry metadata has not changed", () => {
  const result = applyCatalogUpdates(catalog, [
    { name: "devroost-node-24", digest: digest("a") }
  ]);
  assert.equal(result.changed, false);
  assert.deepEqual(result.catalog, catalog);
});

test("updates a changed digest behind the pinned upstream tag", () => {
  const result = applyCatalogUpdates(catalog, [
    { name: "devroost-node-24", digest: digest("b") }
  ]);
  assert.equal(result.changed, true);
  assert.equal(
    result.catalog.images[0].source,
    `docker.io/library/node:24.20.0-alpine@${digest("b")}`
  );
});

test("applies an explicitly reported tool source and version change", () => {
  const result = applyCatalogUpdates(catalog, [
    {
      name: "devroost-node-24",
      source: "docker.io/library/node:24.5.0-alpine",
      digest: digest("c"),
      version: "24.5.0-devroost.1"
    }
  ]);
  assert.equal(result.catalog.images[0].version, "24.5.0-devroost.1");
  assert.equal(
    result.catalog.images[0].source,
    `docker.io/library/node:24.5.0-alpine@${digest("c")}`
  );
});

test("fails the whole check without returning a partial catalog on registry failure", async () => {
  await assert.rejects(
    checkCatalogUpdates(catalog, async () => {
      throw new Error("registry unavailable");
    }),
    /devroost-node-24.*registry unavailable/
  );
});
