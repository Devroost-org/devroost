import assert from "node:assert/strict";
import test from "node:test";

import { createPublishedImageResolver } from "./image-pins.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const validDocument = {
  schemaVersion: 1,
  registry: "ghcr.io/devroost-org",
  images: [
    {
      name: "devroost-node-24",
      image: "ghcr.io/devroost-org/devroost-node-24",
      digest: digest("a")
    }
  ]
};

test("resolves a published image to its immutable GHCR manifest", () => {
  const resolveImage = createPublishedImageResolver(validDocument);

  assert.equal(
    resolveImage("devroost-node-24"),
    `ghcr.io/devroost-org/devroost-node-24@${digest("a")}`
  );
});

test("rejects an unsupported schema and registry", () => {
  assert.throws(
    () => createPublishedImageResolver({ ...validDocument, schemaVersion: 2 }),
    /schemaVersion.*1/i
  );
  assert.throws(
    () => createPublishedImageResolver({ ...validDocument, registry: "docker.io/devroost-org" }),
    /registry.*ghcr\.io\/devroost-org/i
  );
});

test("rejects duplicate, malformed, and mismatched image records", () => {
  assert.throws(
    () => createPublishedImageResolver({
      ...validDocument,
      images: [...validDocument.images, validDocument.images[0]]
    }),
    /duplicate.*devroost-node-24/i
  );
  assert.throws(
    () => createPublishedImageResolver({
      ...validDocument,
      images: [{ ...validDocument.images[0], image: "ghcr.io/devroost-org/wrong" }]
    }),
    /devroost-node-24.*repository/i
  );
  for (const invalidDigest of [`sha256:${"A".repeat(64)}`, "sha256:short"]) {
    assert.throws(
      () => createPublishedImageResolver({
        ...validDocument,
        images: [{ ...validDocument.images[0], digest: invalidDigest }]
      }),
      /devroost-node-24.*digest/i
    );
  }
});

test("rejects an unknown requested image", () => {
  const resolveImage = createPublishedImageResolver(validDocument);

  assert.throws(() => resolveImage("devroost-node-22"), /unknown.*devroost-node-22/i);
});
