import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  renderPublishedImageData,
  replaceEnvironmentDefault,
  replaceReadmeDefault,
  replaceYamlDefault
} from "./sync-stack-image-pins.mjs";

const reference = `ghcr.io/loom-development/loom-node-24@sha256:${"a".repeat(64)}`;
const document = {
  schemaVersion: 1,
  registry: "ghcr.io/loom-development",
  images: [
    { name: "loom-node-24", image: "ghcr.io/loom-development/loom-node-24", digest: `sha256:${"a".repeat(64)}` }
  ]
};
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("renders stable generated TypeScript from a digest document", () => {
  const rendered = renderPublishedImageData(document);

  assert.match(rendered, /Generated from images\/digests\.json\. Do not edit by hand\./);
  assert.match(rendered, /"loom-node-24"/);
  assert.equal(renderPublishedImageData(document), rendered);
});

test("updates only a declared YAML image default", () => {
  assert.equal(
    replaceYamlDefault("    image: ${NODE_IMAGE:-old}\n", "NODE_IMAGE", reference),
    `    image: \${NODE_IMAGE:-${reference}}\n`
  );
  assert.throws(
    () => replaceYamlDefault("    image: ${OTHER_IMAGE:-old}\n", "NODE_IMAGE", reference),
    /NODE_IMAGE.*devroost\.yaml/i
  );
});

test("updates exact environment and README defaults", () => {
  assert.equal(
    replaceEnvironmentDefault("NODE_IMAGE=old\nHOST_UID=1000\n", "NODE_IMAGE", reference),
    `NODE_IMAGE=${reference}\nHOST_UID=1000\n`
  );
  assert.equal(
    replaceReadmeDefault("`${NODE_IMAGE:-old}`\n", "NODE_IMAGE", reference),
    `\`\${NODE_IMAGE:-${reference}}\`\n`
  );
  assert.equal(
    replaceReadmeDefault("- `NODE_IMAGE=old`\n", "NODE_IMAGE", reference),
    `- \`NODE_IMAGE=${reference}\`\n`
  );
  assert.throws(
    () => replaceEnvironmentDefault("OTHER_IMAGE=old\n", "NODE_IMAGE", reference),
    /NODE_IMAGE.*\.env\.example/i
  );
  assert.throws(
    () => replaceReadmeDefault("No image here.\n", "NODE_IMAGE", reference),
    /NODE_IMAGE.*README/i
  );
});

test("tracked documentation explains published image consumption and maintenance", async () => {
  const rootReadme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
  const imageReadme = await readFile(path.join(repositoryRoot, "images/README.md"), "utf8");

  assert.match(rootReadme, /existing projects/i);
  assert.match(rootReadme, /\*_IMAGE/);
  for (const phrase of ["images/digests.json", "pnpm images:sync-stacks", "automation/image-digests"]) {
    assert.match(imageReadme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
