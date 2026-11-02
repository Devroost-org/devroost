import { readFile } from "node:fs/promises";

export async function loadCatalog(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  const errors = validateCatalog(value);
  if (errors.length > 0) {
    throw new Error(`Invalid image catalog:\n- ${errors.join("\n- ")}`);
  }
  return value;
}

export function validateCatalog(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["catalog must be an object"];
  }

  const errors = [];
  const names = new Set();

  if (value.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }

  if (value.registry !== "ghcr.io/devroost-org") {
    errors.push('registry must be "ghcr.io/devroost-org"');
  }

  if (!Array.isArray(value.images)) {
    errors.push("images must be an array");
    return errors;
  }

  for (const [index, image] of value.images.entries()) {
    if (image === null || typeof image !== "object" || Array.isArray(image)) {
      errors.push(`image at index ${index} must be an object`);
      continue;
    }

    if (typeof image.name !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(image.name)) {
      errors.push(`image at index ${index} has invalid name "${String(image.name)}"`);
    }

    if (names.has(image.name)) {
      errors.push(`images contains duplicate name "${image.name}"`);
    }
    names.add(image.name);

    if (image.kind !== "custom" && image.kind !== "mirror") {
      errors.push(`image "${image.name}" kind must be custom or mirror`);
    }

    if (
      typeof image.source !== "string" ||
      !/@sha256:[a-f0-9]{64}$/.test(image.source)
    ) {
      errors.push(
        `image "${image.name}" source must include an immutable sha256 digest`
      );
    }

    if (typeof image.version !== "string" || image.version.length === 0) {
      errors.push(`image "${image.name}" must define a non-empty version`);
    }

    if (!Array.isArray(image.platforms)) {
      errors.push(`image "${image.name}" platforms must be an array`);
    } else {
      const platforms = new Set(image.platforms);
      if (
        image.kind === "custom" &&
        (!platforms.has("linux/amd64") || !platforms.has("linux/arm64"))
      ) {
        errors.push(
          `image "${image.name}" must support linux/amd64 and linux/arm64`
        );
      }
      if (
        image.kind === "mirror" &&
        !platforms.has("linux/arm64") &&
        (typeof image.platformLimit !== "string" || image.platformLimit.length === 0)
      ) {
        errors.push(
          `mirror "${image.name}" without linux/arm64 must define platformLimit`
        );
      }
    }

    if (
      image.kind === "custom" &&
      (typeof image.context !== "string" ||
        !image.context.startsWith("images/") ||
        image.context.includes(".."))
    ) {
      errors.push(
        `custom image "${image.name}" must define a relative context under images/`
      );
    }
  }

  const imagesByName = new Map(value.images.map((image) => [image.name, image]));
  for (const image of value.images) {
    if (image === null || typeof image !== "object" || !("runtime" in image)) {
      continue;
    }
    if (
      typeof image.runtime !== "string" ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(image.runtime)
    ) {
      errors.push(
        `image "${image.name}" has invalid runtime "${String(image.runtime)}"`
      );
      continue;
    }

    const runtime = imagesByName.get(image.runtime);
    if (!runtime) {
      errors.push(
        `image "${image.name}" runtime "${image.runtime}" does not exist`
      );
      continue;
    }
    if (runtime.kind !== "custom") {
      errors.push(
        `image "${image.name}" runtime "${image.runtime}" must be custom`
      );
      continue;
    }
    for (const platform of Array.isArray(image.platforms) ? image.platforms : []) {
      if (!runtime.platforms.includes(platform)) {
        errors.push(
          `image "${image.name}" platform "${platform}" is not supported by runtime "${image.runtime}"`
        );
      }
    }
  }

  const visited = new Set();
  const visiting = new Set();
  function visit(image, path) {
    if (visiting.has(image.name)) {
      const cycleStart = path.indexOf(image.name);
      const cycle = [...path.slice(cycleStart), image.name];
      errors.push(`image runtime dependency cycle: ${cycle.join(" -> ")}`);
      return;
    }
    if (visited.has(image.name)) {
      return;
    }

    visiting.add(image.name);
    if (typeof image.runtime === "string") {
      const runtime = imagesByName.get(image.runtime);
      if (runtime?.kind === "custom") {
        visit(runtime, [...path, image.name]);
      }
    }
    visiting.delete(image.name);
    visited.add(image.name);
  }

  for (const image of value.images) {
    if (image !== null && typeof image === "object") {
      visit(image, []);
    }
  }

  return errors;
}
