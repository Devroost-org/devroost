import test from "node:test";
import assert from "node:assert/strict";
import {
  findStackDefinition,
  listStackIds,
  publishedImage,
  stackDefinitions,
  stackIds,
  validateStackDefinition
} from "./stacks.js";

test("stack registry contains unique definitions for every published stack", () => {
  const ids = stackDefinitions.map((definition) => definition.id);

  assert.equal(ids.length, 31);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(listStackIds(), [...ids].sort());
});

test("stack definitions expose assets, scaffold versions, and initial Devroost ownership", () => {
  const rails = findStackDefinition("rails7");
  assert.equal(rails?.id, "rails7");
  assert.equal(rails?.assetPath, "rails7/templates");
  assert.equal(rails?.scaffoldVersion, "2");
  assert.deepEqual(rails?.legacyScaffoldVersions, ["2", "rails-7.1.5"]);
  assert.deepEqual(rails?.devroostOwnedFiles, [".env.example", "devroost.yaml"]);
  assert.equal(findStackDefinition("missing"), undefined);

  const node = findStackDefinition("node");
  assert.equal(node?.definitionVersion, 2);
  assert.deepEqual(node?.legacyScaffoldVersions, ["1", "2"]);
  assert.equal(node?.assetPath, "node/templates");
  assert.deepEqual(node?.runtimeImages, [
    { env: "NODE_IMAGE", reference: publishedImage("devroost-node-24") }
  ]);
  assert.match(node!.runtimeImages[0]!.reference, /^ghcr\.io\/devroost-org\/devroost-node-24@sha256:[a-f0-9]{64}$/);
});

test("every stack has explicit, deterministic maintenance metadata", () => {
  assert.deepEqual([...stackIds].sort(), listStackIds());

  for (const definition of stackDefinitions) {
    assert.doesNotThrow(() => validateStackDefinition(definition));
    assert.deepEqual(
      definition.generatedPaths.map(({ path }) => path),
      definition.generatedPaths.map(({ path }) => path).sort()
    );
    assert.equal(
      new Set(definition.generatedPaths.map(({ path }) => path)).size,
      definition.generatedPaths.length
    );
    assert.deepEqual([...definition.protectedPaths], [...definition.protectedPaths].sort());
    assert.equal(definition.compatibility.runtime, "podman-rootless");
    assert.ok(definition.compatibility.architectures.length > 0);
    assert.ok(definition.compatibility.architectures.every((architecture) => ["arm", "arm64", "x64"].includes(architecture)));
  }
});

test("representative stacks expose their exact generated paths", () => {
  assert.deepEqual(findStackDefinition("node")?.generatedPaths, [
    { path: "dist", category: "build" },
    { path: "node_modules", category: "dependency" }
  ]);
  assert.deepEqual(findStackDefinition("php")?.generatedPaths, [
    { path: "vendor", category: "dependency" }
  ]);
  assert.deepEqual(findStackDefinition("db-postgres")?.generatedPaths, []);
});

test("stack validation rejects unsafe, duplicate, unsorted, and overlapping paths", () => {
  const node = findStackDefinition("node")!;
  const unsafePaths = ["", ".", "/tmp/cache", "../cache", "cache/../dist", ".devroost", ".devroost/cache"];

  for (const path of unsafePaths) {
    assert.throws(
      () => validateStackDefinition({ ...node, generatedPaths: [{ path, category: "cache" }] }),
      /unsafe generated path/i
    );
  }

  assert.throws(
    () => validateStackDefinition({
      ...node,
      generatedPaths: [
        { path: "dist", category: "build" },
        { path: "dist", category: "cache" }
      ]
    }),
    /duplicate generated path/i
  );
  assert.throws(
    () => validateStackDefinition({
      ...node,
      generatedPaths: [
        { path: "node_modules", category: "dependency" },
        { path: "dist", category: "build" }
      ]
    }),
    /sorted/i
  );
  assert.throws(
    () => validateStackDefinition({ ...node, protectedPaths: ["../src"] }),
    /unsafe protected path/i
  );
  assert.throws(
    () => validateStackDefinition({
      ...node,
      generatedPaths: [{ path: "src", category: "cache" }]
    }),
    /contains protected path/i
  );
});
