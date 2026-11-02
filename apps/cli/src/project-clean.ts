import {
  lstat as nodeLstat,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
  rm as nodeRm
} from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Dirent, Stats } from "node:fs";
import type { LoomProjectManifestV2 } from "./project-manifest.js";
import type { GeneratedPathCategory, StackDefinition } from "./stacks.js";

export interface ProjectCleanItem {
  path: string;
  category: GeneratedPathCategory;
  exists: boolean;
  bytes: number;
}

export interface ProjectCleanPlan {
  projectRoot: string;
  items: ProjectCleanItem[];
  totalBytes: number;
  /** Safety context retained so execution can repeat every protection check. */
  protectedPaths: string[];
}

export interface PlanProjectCleanOptions {
  projectRoot: string;
  stack: StackDefinition;
  manifest: LoomProjectManifestV2;
  dependencies?: Partial<ProjectCleanDependencies>;
}

export interface ProjectCleanDependencies {
  lstat(path: string): Promise<Stats>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  realpath(path: string): Promise<string>;
  rm(path: string, options: { recursive: true; force: false }): Promise<void>;
}

const defaultDependencies: ProjectCleanDependencies = {
  lstat: nodeLstat,
  readdir: (path, options) => nodeReaddir(path, options),
  realpath: nodeRealpath,
  rm: nodeRm
};

const fixedProtectedPaths = [".env", "devroost.yaml"] as const;
const dependencyManifestNames = new Set([
  "Cargo.toml", "Gemfile", "Pipfile", "composer.json", "package.json", "pom.xml",
  "pyproject.toml", "requirements.txt", "build.gradle", "build.gradle.kts",
  "settings.gradle", "settings.gradle.kts"
]);
const lockfileNames = new Set([
  "Cargo.lock", "Gemfile.lock", "Pipfile.lock", "bun.lock", "bun.lockb", "composer.lock",
  "gradle.lockfile", "package-lock.json", "packages.lock.json", "pnpm-lock.yaml", "poetry.lock",
  "uv.lock", "yarn.lock"
]);

function dependencies(overrides?: Partial<ProjectCleanDependencies>): ProjectCleanDependencies {
  return { ...defaultDependencies, ...overrides };
}

function isKnownProtectedFile(path: string): boolean {
  const name = path.split("/").at(-1)!;
  return name === ".env" || name === "devroost.yaml" || dependencyManifestNames.has(name) || lockfileNames.has(name) ||
    name.endsWith(".csproj") || name.endsWith(".sln") || /^requirements(?:-[^/]+)?\.txt$/.test(name);
}

function assertSafeRelativePath(path: string): void {
  const parts = path.split("/");
  if (!path || path === "." || isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\") ||
      parts.some((part) => !part || part === "." || part === "..") || path === ".devroost" || path.startsWith(".devroost/")) {
    throw new Error(`Unsafe generated path '${path}'`);
  }
}

function containsPath(container: string, protectedPath: string): boolean {
  return container === protectedPath || protectedPath.startsWith(`${container}/`);
}

function assertNotProtected(path: string, protectedPaths: readonly string[]): void {
  if (isKnownProtectedFile(path) || protectedPaths.some((protectedPath) => containsPath(path, protectedPath))) {
    throw new Error(`Generated path '${path}' contains a protected path`);
  }
}

function containedTarget(projectRoot: string, path: string): string {
  const target = resolve(projectRoot, path);
  const fromRoot = relative(projectRoot, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe generated path '${path}' escapes the project root`);
  }
  return target;
}

async function optionalLstat(path: string, fs: ProjectCleanDependencies): Promise<Stats | undefined> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function validatePathChain(projectRoot: string, path: string, fs: ProjectCleanDependencies): Promise<Stats | undefined> {
  let current = projectRoot;
  for (const part of path.split("/")) {
    current = resolve(current, part);
    const stats = await optionalLstat(current, fs);
    if (!stats) return undefined;
    if (stats.isSymbolicLink()) throw new Error(`Generated path '${path}' traverses a symlink at '${current}'`);
  }
  return optionalLstat(containedTarget(projectRoot, path), fs);
}

async function inspectTree(
  absolutePath: string,
  relativePath: string,
  initialStats: Stats,
  fs: ProjectCleanDependencies
): Promise<number> {
  // Package managers routinely create links inside generated dependency trees
  // (for example node_modules/.bin). Do not follow or count them. Safety for
  // the declared target and each of its parents is enforced by validatePathChain.
  if (initialStats.isSymbolicLink()) return 0;
  if (initialStats.isFile()) return initialStats.size;
  if (!initialStats.isDirectory()) return 0;
  let bytes = 0;
  const entries = (await fs.readdir(absolutePath, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const childRelative = `${relativePath}/${entry.name}`;
    const childAbsolute = resolve(absolutePath, entry.name);
    const stats = await fs.lstat(childAbsolute);
    bytes += await inspectTree(childAbsolute, childRelative, stats, fs);
  }
  return bytes;
}

async function discoverProjectManifests(
  projectRoot: string,
  generatedPaths: readonly string[],
  fs: ProjectCleanDependencies
): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, directoryRelative: string): Promise<void> {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childRelative = directoryRelative ? `${directoryRelative}/${entry.name}` : entry.name;
      if (childRelative === ".devroost" || childRelative.startsWith(".devroost/") || childRelative === ".git" ||
          generatedPaths.some((generatedPath) => childRelative === generatedPath || childRelative.startsWith(`${generatedPath}/`))) {
        continue;
      }
      const childAbsolute = resolve(directory, entry.name);
      const stats = await fs.lstat(childAbsolute);
      // Project discovery never follows symlinks. Generated-path validation separately rejects
      // a symlink in any target or target parent.
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) await walk(childAbsolute, childRelative);
      else if (stats.isFile() && isKnownProtectedFile(childRelative)) found.push(childRelative);
    }
  }
  await walk(projectRoot, "");
  return found;
}

async function getProtectedPaths(
  projectRoot: string,
  stack: StackDefinition,
  manifest: LoomProjectManifestV2,
  fs: ProjectCleanDependencies
): Promise<string[]> {
  const discovered = await discoverProjectManifests(projectRoot, stack.generatedPaths.map(({ path }) => path), fs);
  return [...new Set([
    ...fixedProtectedPaths,
    ...stack.protectedPaths,
    ...Object.keys(manifest.ownedFiles),
    ...discovered
  ])].sort();
}

function validateAllDeclarations(items: readonly Pick<ProjectCleanItem, "path" | "category">[], protectedPaths: readonly string[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    assertSafeRelativePath(item.path);
    assertNotProtected(item.path, protectedPaths);
    if (!(["dependency", "cache", "build"] as const).includes(item.category)) {
      throw new Error(`Unsafe generated path category for '${item.path}'`);
    }
    if (seen.has(item.path)) throw new Error(`Unsafe duplicate generated path '${item.path}'`);
    seen.add(item.path);
  }
}

export async function planProjectClean(options: PlanProjectCleanOptions): Promise<ProjectCleanPlan> {
  const fs = dependencies(options.dependencies);
  const projectRoot = await fs.realpath(options.projectRoot);
  const declarations = options.stack.generatedPaths.map(({ path, category }) => ({ path, category }));

  // Reject intrinsically unsafe declarations before walking any filesystem content.
  const initialProtectedPaths = [...fixedProtectedPaths, ...options.stack.protectedPaths, ...Object.keys(options.manifest.ownedFiles)].sort();
  validateAllDeclarations(declarations, initialProtectedPaths);
  const protectedPaths = await getProtectedPaths(projectRoot, options.stack, options.manifest, fs);
  validateAllDeclarations(declarations, protectedPaths);

  const items: ProjectCleanItem[] = [];
  for (const declaration of [...declarations].sort((a, b) => a.path.localeCompare(b.path))) {
    const target = containedTarget(projectRoot, declaration.path);
    const stats = await validatePathChain(projectRoot, declaration.path, fs);
    const bytes = stats ? await inspectTree(target, declaration.path, stats, fs) : 0;
    items.push({ ...declaration, exists: stats !== undefined, bytes });
  }
  return { projectRoot, items, totalBytes: items.reduce((total, item) => total + item.bytes, 0), protectedPaths };
}

export async function applyProjectClean(
  plan: ProjectCleanPlan,
  dependencyOverrides?: Partial<ProjectCleanDependencies>
): Promise<{ removed: string[]; missing: string[] }> {
  const fs = dependencies(dependencyOverrides);
  const projectRoot = await fs.realpath(plan.projectRoot);
  if (projectRoot !== plan.projectRoot) throw new Error("Unsafe cleanup plan project root changed after planning");
  validateAllDeclarations(plan.items, plan.protectedPaths);

  const removed: string[] = [];
  const missing: string[] = [];
  for (const item of [...plan.items].sort((a, b) => a.path.localeCompare(b.path))) {
    const target = containedTarget(projectRoot, item.path);
    const stats = await validatePathChain(projectRoot, item.path, fs);
    if (!stats) {
      missing.push(item.path);
      continue;
    }
    if (!item.exists) throw new Error(`Generated path '${item.path}' appeared after cleanup planning`);
    // Rewalk immediately before removal. Nested links are never followed;
    // validatePathChain above rejects links in the target path itself.
    await inspectTree(target, item.path, stats, fs);
    await fs.rm(target, { recursive: true, force: false });
    removed.push(item.path);
  }
  return { removed, missing };
}
