import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadCatalog } from "./catalog.mjs";
import { run } from "./process.mjs";

const defaultCatalogPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../images/catalog.json"
);

export async function buildImage(name, options = {}) {
  const catalogPath = options.catalogPath ?? defaultCatalogPath;
  const catalog = await loadCatalog(catalogPath);
  const images = new Map(catalog.images.map((image) => [image.name, image]));
  const image = images.get(name);
  if (!image) {
    throw new Error(`Unknown image "${name}"`);
  }
  if (image.kind !== "custom") {
    throw new Error(`Image "${name}" is a mirror and cannot be built`);
  }

  const platform = options.platform ?? "linux/amd64";
  if (!image.platforms.includes(platform)) {
    throw new Error(`Image "${name}" does not support ${platform}`);
  }

  const repositoryRoot = path.resolve(path.dirname(catalogPath), "..");
  const execute = options.execute ?? run;
  const completed = new Map();
  const active = new Set();

  async function build(candidate) {
    if (completed.has(candidate.name)) {
      return completed.get(candidate.name);
    }
    if (active.has(candidate.name)) {
      throw new Error(`Runtime dependency cycle includes "${candidate.name}"`);
    }

    active.add(candidate.name);
    try {
      let baseImage = candidate.source;
      if (candidate.runtime) {
        baseImage = await build(images.get(candidate.runtime));
      }

      const context = path.resolve(repositoryRoot, candidate.context);
      const reference = `localhost/${candidate.name}:${candidate.version}`;
      const buildArguments = ["--build-arg", `DEVROOST_BASE_IMAGE=${baseImage}`];
      if (candidate.runtime) {
        buildArguments.push("--build-arg", `DEVROOST_SOURCE_IMAGE=${candidate.source}`);
      }

      await execute(
        "podman",
        [
          "build",
          "--platform",
          platform,
          ...buildArguments,
          "--file",
          path.join(context, "Containerfile"),
          "--tag",
          reference,
          context
        ],
        { cwd: repositoryRoot }
      );
      completed.set(candidate.name, reference);
      return reference;
    } finally {
      active.delete(candidate.name);
    }
  }

  return build(image);
}

export async function main(args, dependencies = {}) {
  const [name, ...flags] = args;
  if (!name) {
    throw new Error("Usage: build.mjs <catalog-name> [--platform <platform>]");
  }

  let platform = "linux/amd64";
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] !== "--platform" || !flags[index + 1]) {
      throw new Error(`Unknown or incomplete argument "${flags[index]}"`);
    }
    platform = flags[index + 1];
    index += 1;
  }

  const build = dependencies.build ?? buildImage;
  await build(name, { platform });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
