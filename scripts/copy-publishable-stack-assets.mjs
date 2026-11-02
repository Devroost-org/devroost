import { access, cp, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ignoredStackAssetEntries = new Set([
  "node_modules",
  ".pnpm-store",
  ".turbo",
  ".devroost",
  "data",
  "dist",
  ".next",
  ".angular",
  "target",
  "build",
  "vendor",
  "__pycache__",
  ".venv",
  ".pytest_cache",
  "obj",
  "bin"
]);
const ignoredStackAssetFileNames = new Set([".DS_Store", ".env"]);
const ignoredStackAssetFileSuffixes = [".db", ".log", ".pyc", ".sqlite", ".sqlite3", ".tsbuildinfo"];

function shouldCopyTemplatePath(templatesDir, sourcePath) {
  const templatePath = relative(templatesDir, sourcePath).replaceAll("\\", "/");
  if (!templatePath) return true;
  const segments = templatePath.split("/");
  const entryName = segments.at(-1) ?? "";
  if (segments.some((segment) => ignoredStackAssetEntries.has(segment))) return false;
  if (ignoredStackAssetFileNames.has(entryName) || /(?:^|\.)test\.[^/]+$/.test(entryName)) return false;
  return !ignoredStackAssetFileSuffixes.some((suffix) => entryName.endsWith(suffix));
}

export async function copyPublishableStackAssets(sourceStacksDir, targetStacksDir) {
  const compiledStacksDir = resolve(sourceStacksDir, "dist");
  const registry = await import(pathToFileURL(resolve(compiledStacksDir, "index.js")).href);
  const stackIds = registry.stackDefinitions.map(({ id }) => id).sort();
  const stackIdSet = new Set(stackIds);
  if (stackIdSet.size !== stackIds.length) throw new Error("Compiled stack registry contains duplicate IDs");
  for (const stackId of stackIds) await access(resolve(sourceStacksDir, stackId, "templates"));

  function shouldCopyCompiledDefinition(sourcePath) {
    const compiledPath = relative(compiledStacksDir, sourcePath).replaceAll("\\", "/");
    if (!compiledPath) return true;
    if (["definition.js", "documentation.js", "image-pins.js", "index.js", "pins.js", "published-image-data.js"].includes(compiledPath)) return true;
    if (!compiledPath.includes("/")) return stackIdSet.has(compiledPath);
    const [stackId, fileName, ...rest] = compiledPath.split("/");
    return rest.length === 0 && stackIdSet.has(stackId) && fileName === "stack.js";
  }

  await rm(targetStacksDir, { recursive: true, force: true });
  await cp(compiledStacksDir, targetStacksDir, {
    recursive: true,
    filter: shouldCopyCompiledDefinition
  });

  for (const stackId of stackIds) {
    const sourceTemplatesDir = resolve(sourceStacksDir, stackId, "templates");
    await cp(sourceTemplatesDir, resolve(targetStacksDir, stackId, "templates"), {
      recursive: true,
      filter: (sourcePath) => shouldCopyTemplatePath(sourceTemplatesDir, sourcePath)
    });
  }
}
