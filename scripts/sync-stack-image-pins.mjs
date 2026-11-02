import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const executeFile = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceRequired(source, pattern, replacement, label) {
  let matches = 0;
  const result = source.replace(pattern, (...args) => {
    matches += 1;
    return typeof replacement === "function" ? replacement(...args) : replacement;
  });
  if (matches === 0) throw new Error(`Missing ${label}`);
  return result;
}

export function renderPublishedImageData(document) {
  if (document?.schemaVersion !== 1) throw new Error("Digest document schemaVersion must be 1");
  if (document?.registry !== "ghcr.io/devroost-org") throw new Error("Digest document registry is invalid");
  if (!Array.isArray(document?.images)) throw new Error("Digest document images must be an array");
  const names = new Set();
  const images = [...document.images].sort((left, right) => left.name.localeCompare(right.name)).map((record) => {
    if (typeof record.name !== "string" || !record.name) throw new Error("Digest record name is required");
    if (names.has(record.name)) throw new Error(`Duplicate digest record ${record.name}`);
    names.add(record.name);
    const image = `${document.registry}/${record.name}`;
    if (record.image !== image) throw new Error(`Digest record ${record.name} repository must be ${image}`);
    if (!digestPattern.test(record.digest ?? "")) throw new Error(`Digest record ${record.name} has an invalid digest`);
    return { name: record.name, image: record.image, digest: record.digest };
  });
  const serialized = JSON.stringify({ schemaVersion: 1, registry: document.registry, images }, null, 2);
  return `// Generated from images/digests.json. Do not edit by hand.\nexport const publishedImageDocument = ${serialized} as const;\n\nexport type PublishedImageName = typeof publishedImageDocument.images[number]["name"];\n`;
}

export function replaceYamlDefault(source, environment, reference) {
  const name = escapeRegExp(environment);
  return replaceRequired(
    source,
    new RegExp(`(image:\\s*\\$\\{${name}:-)[^}\\n]+(\\})`, "g"),
    (_match, prefix, suffix) => `${prefix}${reference}${suffix}`,
    `${environment} default in devroost.yaml`
  );
}

export function replaceEnvironmentDefault(source, environment, reference) {
  const name = escapeRegExp(environment);
  return replaceRequired(
    source,
    new RegExp(`^${name}=.*$`, "gm"),
    `${environment}=${reference}`,
    `${environment} default in .env.example`
  );
}

export function replaceReadmeDefault(source, environment, reference) {
  const name = escapeRegExp(environment);
  let matches = 0;
  let result = source.replace(new RegExp(`(\\$\\{${name}:-)[^}\\s]+(\\})`, "g"), (_match, prefix, suffix) => {
    matches += 1;
    return `${prefix}${reference}${suffix}`;
  });
  result = result.replace(new RegExp(`(^|[\\s\\x60])${name}=[^\\s\\x60]+`, "gm"), (_match, prefix) => {
    matches += 1;
    return `${prefix}${environment}=${reference}`;
  });
  if (matches === 0) throw new Error(`Missing ${environment} default in README`);
  return result;
}

async function updateFile(file, transform) {
  const source = await readFile(file, "utf8");
  const result = transform(source);
  if (result !== source) await writeFile(file, result);
}

export async function main(args = []) {
  if (args.length !== 0) throw new Error("Usage: sync-stack-image-pins.mjs");
  const digestPath = path.join(repositoryRoot, "images/digests.json");
  const dataPath = path.join(repositoryRoot, "stacks/published-image-data.ts");
  const document = JSON.parse(await readFile(digestPath, "utf8"));
  await writeFile(dataPath, renderPublishedImageData(document));

  await executeFile("pnpm", ["--dir", "stacks", "build"], { cwd: repositoryRoot });
  const registryUrl = `${pathToFileURL(path.join(repositoryRoot, "stacks/dist/index.js")).href}?sync=${Date.now()}`;
  const { stackDefinitions } = await import(registryUrl);
  for (const definition of stackDefinitions) {
    const templateRoot = path.join(repositoryRoot, "stacks", definition.id, "templates");
    for (const { env, reference } of definition.runtimeImages) {
      await updateFile(path.join(templateRoot, "devroost.yaml"), (source) => replaceYamlDefault(source, env, reference));
      await updateFile(path.join(templateRoot, ".env.example"), (source) => replaceEnvironmentDefault(source, env, reference));
      await updateFile(path.join(templateRoot, "README.md"), (source) => replaceReadmeDefault(source, env, reference));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
