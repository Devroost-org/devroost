import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadCatalog } from "./catalog.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const defaultCatalogPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../images/catalog.json"
);

function samePlatforms(actual, expected) {
  return JSON.stringify([...(actual ?? [])].sort()) === JSON.stringify([...expected].sort());
}

export function createDigestDocument(catalog, releases, signatureIdentity) {
  const releasesByName = new Map();
  for (const release of releases) {
    if (releasesByName.has(release.name)) {
      throw new Error(`duplicate release digest for ${release.name}`);
    }
    releasesByName.set(release.name, release);
  }

  for (const image of catalog.images) {
    if (!releasesByName.has(image.name)) {
      throw new Error(`missing release digest for ${image.name}`);
    }
  }
  for (const name of releasesByName.keys()) {
    if (!catalog.images.some((image) => image.name === name)) {
      throw new Error(`release digest references unknown image ${name}`);
    }
  }

  const images = [...catalog.images]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((image) => {
      const release = releasesByName.get(image.name);
      if (!samePlatforms(release.platforms, image.platforms)) {
        throw new Error(`release platforms do not match catalog for ${image.name}`);
      }
      const record = {
        name: image.name,
        version: image.version,
        image: `${catalog.registry}/${image.name}`,
        digest: release.digest,
        platforms: [...release.platforms].sort()
      };
      if (image.kind === "mirror") {
        record.upstreamDigest = image.source.slice(image.source.lastIndexOf("@") + 1);
      }
      return record;
    });

  const document = {
    schemaVersion: 1,
    registry: catalog.registry,
    signatureIdentity,
    images
  };
  const errors = validateDigestDocument(document, catalog);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return document;
}

export function validateDigestDocument(document, catalog, { requireCurrentSources = true } = {}) {
  const records = Array.isArray(document?.images) ? document.images : [];
  const recordsByName = new Map(records.map((record) => [record.name, record]));
  const errors = [];

  for (const image of catalog.images) {
    if (!recordsByName.has(image.name)) errors.push(`digest catalog is missing ${image.name}`);
  }
  for (const record of records) {
    if (!catalog.images.some((image) => image.name === record.name)) {
      errors.push(`digest catalog contains unknown image ${record.name}`);
    }
  }

  for (const record of records) {
    if (!digestPattern.test(record.digest ?? "")) {
      errors.push(`${record.name} must have a valid sha256 digest`);
    }
  }
  for (const record of records) {
    if (record.image !== `${catalog.registry}/${record.name}`) {
      errors.push(`${record.name} must use the exact GHCR namespace`);
    }
  }
  for (const record of records) {
    const image = catalog.images.find((candidate) => candidate.name === record.name);
    if (image && !samePlatforms(record.platforms, image.platforms)) {
      errors.push(`${record.name} platforms do not match the catalog`);
    }
  }
  for (const record of records) {
    const image = catalog.images.find((candidate) => candidate.name === record.name);
    if (image?.kind === "mirror") {
      const expected = image.source.slice(image.source.lastIndexOf("@") + 1);
      if (!digestPattern.test(record.upstreamDigest ?? "") ||
          (requireCurrentSources && record.upstreamDigest !== expected)) {
        errors.push(`${record.name} must record its upstream digest`);
      }
    }
  }

  if (document?.registry !== catalog.registry) errors.push("digest catalog registry is incorrect");
  if (!document?.signatureIdentity) errors.push("digest catalog signature identity is required");
  return errors;
}

async function loadReleaseRecords(directory) {
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => JSON.parse(await fs.readFile(path.join(directory, name), "utf8")))
  );
}

export async function main(args, dependencies = {}) {
  const [releaseDirectory, outputPath, ...rest] = args;
  if (!releaseDirectory || rest.length > 0) {
    throw new Error("Usage: digests.mjs <release-record-directory> [output-path]");
  }

  const catalog = await (dependencies.loadCatalog ?? loadCatalog)(
    dependencies.catalogPath ?? defaultCatalogPath
  );
  const releases = await (dependencies.loadReleases ?? loadReleaseRecords)(releaseDirectory);
  const identity = dependencies.signatureIdentity
    ?? "https://github.com/Loom-development/Loom/.github/workflows/images-release.yml@refs/heads/main";
  const document = createDigestDocument(catalog, releases, identity);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (outputPath) await fs.writeFile(outputPath, serialized);
  else process.stdout.write(serialized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
