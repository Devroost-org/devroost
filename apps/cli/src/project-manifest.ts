import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { StackDefinition } from "./stacks.js";

export interface DevroostProjectManifestV1 {
  version: 1;
  devroostVersion: string;
  stack: { id: string; scaffoldVersion: string };
  ownedFiles: Record<string, { sha256: string }>;
}

export interface ProjectRenderInputs {
  projectName: string;
  phpDocroot?: string;
  databases: string[];
  adopted: boolean;
}

export interface DevroostProjectManifestV2 {
  version: 2;
  devroostVersion: string;
  stack: { id: string; scaffoldVersion: string; definitionVersion?: number };
  ownedFiles: Record<string, { sha256: string; baselinePath: string }>;
  renderInputs: ProjectRenderInputs;
}

export type DevroostProjectManifest = Omit<DevroostProjectManifestV2, "stack"> & {
  stack: { id: string; scaffoldVersion: string; definitionVersion: number };
};
export type LoadedProjectManifest =
  | { kind: "ready"; manifest: DevroostProjectManifestV2 }
  | { kind: "migration-required"; manifest: DevroostProjectManifestV1 }
  | { kind: "missing" };
export type ProjectManifestStackCompatibility =
  | { kind: "current" }
  | { kind: "legacy-compatible" }
  | { kind: "incompatible"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeRelativePath(path: string, label: string): void {
  const segments = path.split(/[\\/]/);
  if (!path || isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || segments.some((segment) => !segment || segment === ".." || segment === ".")) {
    throw new Error(`Unsafe ${label} '${path}' in Devroost project manifest`);
  }
}

function assertCommonManifest(value: Record<string, unknown>): void {
  if (typeof value.devroostVersion !== "string" || !isRecord(value.stack) ||
      typeof value.stack.id !== "string" || typeof value.stack.scaffoldVersion !== "string" ||
      !isRecord(value.ownedFiles)) throw new Error("Invalid Devroost project manifest");
}

function parseV1(value: Record<string, unknown>): DevroostProjectManifestV1 {
  assertCommonManifest(value);
  for (const [path, entry] of Object.entries(value.ownedFiles as Record<string, unknown>)) {
    assertSafeRelativePath(path, "owned file path");
    if (!isRecord(entry) || typeof entry.sha256 !== "string") throw new Error("Invalid Devroost project manifest owned file entry");
  }
  return value as unknown as DevroostProjectManifestV1;
}

function parseV2(value: Record<string, unknown>): DevroostProjectManifestV2 {
  assertCommonManifest(value);
  const definitionVersion = (value.stack as Record<string, unknown>).definitionVersion;
  if (definitionVersion !== undefined && (!Number.isInteger(definitionVersion) || (definitionVersion as number) <= 0)) {
    throw new Error("Invalid Devroost project manifest stack definition version");
  }
  for (const [path, entry] of Object.entries(value.ownedFiles as Record<string, unknown>)) {
    assertSafeRelativePath(path, "owned file path");
    if (!isRecord(entry) || typeof entry.sha256 !== "string" || typeof entry.baselinePath !== "string") {
      throw new Error("Invalid Devroost project manifest owned file entry");
    }
    assertSafeRelativePath(entry.baselinePath, "baseline path");
  }
  if (!isRecord(value.renderInputs) || typeof value.renderInputs.projectName !== "string" ||
      typeof value.renderInputs.adopted !== "boolean" || !Array.isArray(value.renderInputs.databases) ||
      !value.renderInputs.databases.every((database) => typeof database === "string") ||
      (value.renderInputs.phpDocroot !== undefined && typeof value.renderInputs.phpDocroot !== "string")) {
    throw new Error("Invalid Devroost project manifest render inputs");
  }
  return value as unknown as DevroostProjectManifestV2;
}

export function classifyProjectManifestStack(
  manifest: DevroostProjectManifestV1 | DevroostProjectManifestV2,
  stack: StackDefinition
): ProjectManifestStackCompatibility {
  if (manifest.stack.id !== stack.id) {
    return { kind: "incompatible", reason: `Manifest stack '${manifest.stack.id}' does not match '${stack.id}'` };
  }
  const definitionVersion = "definitionVersion" in manifest.stack ? manifest.stack.definitionVersion : undefined;
  if (definitionVersion === stack.definitionVersion && manifest.stack.scaffoldVersion === stack.scaffoldVersion) {
    return { kind: "current" };
  }
  if ((definitionVersion === undefined || definitionVersion < stack.definitionVersion) &&
      stack.legacyScaffoldVersions.includes(manifest.stack.scaffoldVersion)) {
    return { kind: "legacy-compatible" };
  }
  if (definitionVersion !== undefined && definitionVersion > stack.definitionVersion) {
    return {
      kind: "incompatible",
      reason: `Manifest definition version ${definitionVersion} is newer than supported version ${stack.definitionVersion}`
    };
  }
  return {
    kind: "incompatible",
    reason: `Scaffold version '${manifest.stack.scaffoldVersion}' is not a declared legacy scaffold version for '${stack.id}'`
  };
}

async function sha256File(path: string): Promise<string | undefined> {
  try {
    const contents = await readFile(path);
    return createHash("sha256").update(contents).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function getBaselinePath(relativePath: string, sha256: string): string {
  return `.devroost/baselines/${sha256}-${encodeURIComponent(relativePath)}`;
}

export async function buildProjectManifest(
  targetDir: string,
  devroostVersion: string,
  stack: StackDefinition,
  ownedFilePaths: readonly string[],
  renderInputs: ProjectRenderInputs
): Promise<DevroostProjectManifest> {
  const ownedFiles: DevroostProjectManifestV2["ownedFiles"] = {};
  for (const relativePath of ownedFilePaths) {
    assertSafeRelativePath(relativePath, "owned file path");
    const sha256 = await sha256File(resolve(targetDir, relativePath));
    if (sha256) ownedFiles[relativePath] = { sha256, baselinePath: getBaselinePath(relativePath, sha256) };
  }
  return {
    version: 2,
    devroostVersion,
    stack: { id: stack.id, scaffoldVersion: stack.scaffoldVersion, definitionVersion: stack.definitionVersion },
    ownedFiles,
    renderInputs: {
      projectName: renderInputs.projectName,
      ...(renderInputs.phpDocroot === undefined ? {} : { phpDocroot: renderInputs.phpDocroot }),
      databases: [...renderInputs.databases].sort(),
      adopted: renderInputs.adopted
    }
  };
}

export async function loadProjectManifest(targetDir: string): Promise<LoadedProjectManifest> {
  let contents: string;
  try {
    contents = await readFile(resolve(targetDir, ".devroost", "manifest.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  const value: unknown = JSON.parse(contents);
  if (!isRecord(value) || typeof value.version !== "number") throw new Error("Invalid Devroost project manifest");
  if (value.version === 1) return { kind: "migration-required", manifest: parseV1(value) };
  if (value.version === 2) return { kind: "ready", manifest: parseV2(value) };
  throw new Error(`Unsupported manifest version '${value.version}'`);
}

export async function writeProjectManifest(
  targetDir: string,
  devroostVersion: string,
  stack: StackDefinition,
  ownedFilePaths: readonly string[],
  renderInputs: ProjectRenderInputs
): Promise<string> {
  const manifest = await buildProjectManifest(targetDir, devroostVersion, stack, ownedFilePaths, renderInputs);
  const devroostDir = resolve(targetDir, ".devroost");
  const manifestPath = resolve(devroostDir, "manifest.json");
  const temporaryPath = resolve(devroostDir, `manifest.json.tmp-${process.pid}`);
  await mkdir(resolve(devroostDir, "baselines"), { recursive: true });
  for (const [relativePath, entry] of Object.entries(manifest.ownedFiles)) {
    const destination = resolve(targetDir, entry.baselinePath);
    const temporaryBaseline = `${destination}.tmp-${process.pid}`;
    try {
      await writeFile(temporaryBaseline, await readFile(resolve(targetDir, relativePath)));
      await rename(temporaryBaseline, destination);
    } finally {
      await rm(temporaryBaseline, { force: true });
    }
  }
  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return manifestPath;
}
