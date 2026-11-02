import { createHash } from "node:crypto";
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { buildDatabaseServiceBlock } from "./database-service.js";
import type { DbType } from "./init-prompt.js";
import { classifyProjectManifestStack, type LoomProjectManifestV2 } from "./project-manifest.js";
import type { StackDefinition } from "./stacks.js";

export type ProjectUpgradeFileState = "unchanged" | "modified" | "missing";

export interface ProjectUpgradeFilePlan {
  path: string;
  state: ProjectUpgradeFileState;
  currentSha256?: string;
  baselineSha256: string;
  candidateSha256: string;
  candidatePath: string;
}

export interface ProjectUpgradePlan {
  projectRoot: string;
  candidateRoot: string;
  manifest: LoomProjectManifestV2;
  stack: StackDefinition;
  files: ProjectUpgradeFilePlan[];
}

export interface PlanProjectUpgradeOptions {
  projectRoot: string;
  stacksRoot: string;
  manifest: LoomProjectManifestV2;
  stack: StackDefinition;
}

export interface ApplyProjectUpgradeOptions {
  forceModified: boolean;
}

function assertSafeRelativePath(path: string, label: string): void {
  const segments = path.split(/[\\/]/);
  if (!path || isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe ${label} '${path}'`);
  }
}

function resolveContained(root: string, path: string, label: string): string {
  assertSafeRelativePath(path, label);
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, path);
  const fromRoot = relative(resolvedRoot, resolvedPath);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error(`Unsafe ${label} '${path}'`);
  return resolvedPath;
}

async function sha256File(path: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertNoSymlinkPath(root: string, relativePath: string, label: string): Promise<string> {
  assertSafeRelativePath(relativePath, label);
  const resolvedRoot = await realpath(root);
  const destination = resolve(resolvedRoot, relativePath);
  const fromRealRoot = relative(resolvedRoot, destination);
  if (!fromRealRoot || fromRealRoot.startsWith("..") || isAbsolute(fromRealRoot)) throw new Error(`Unsafe ${label} '${relativePath}'`);
  let current = resolvedRoot;
  for (const segment of relativePath.split(/[\\/]/)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlinked ${label} '${relativePath}'`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return destination;
}

function baselinePath(path: string, sha256: string): string {
  return `.devroost/baselines/${sha256}-${encodeURIComponent(path)}`;
}

export function renderProjectName(devroostYaml: string, projectName: string): string {
  return devroostYaml.replace(/^(name:\s*).+$/m, `$1${projectName}`);
}

function normalizeDocrootPath(raw: string): string {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return !normalized || normalized === "." ? "." : normalized;
}

function buildPhpBaseCommand(containerDocroot: string): string {
  return [
    "command: |", "      set -eu", '      target_uid="${HOST_UID:-1000}"', '      target_gid="${HOST_GID:-1000}"',
    '      current_gid="$(getent group www-data | cut -d: -f3)"', '      if [ "$current_gid" != "$target_gid" ]; then', '        if getent group "$target_gid" >/dev/null 2>&1; then', '          existing_group="$(getent group "$target_gid" | cut -d: -f1)"', '          usermod -g "$existing_group" www-data', '        else', '          groupmod -o -g "$target_gid" www-data', '        fi', '      fi',
    '      current_uid="$(id -u www-data)"', '      if [ "$current_uid" != "$target_uid" ]; then', '        if getent passwd "$target_uid" >/dev/null 2>&1; then', '          existing_user="$(getent passwd "$target_uid" | cut -d: -f1)"', '          usermod -l loom-www-data -m -d /var/www -s /usr/sbin/nologin "$existing_user" >/dev/null 2>&1 || true', '        fi', '        usermod -o -u "$target_uid" www-data', '      fi',
    "      cat > /etc/apache2/sites-available/000-default.conf << 'APACHE_CONF'", '      <VirtualHost *:80>', `          DocumentRoot ${containerDocroot}`, `          <Directory ${containerDocroot}>`, '              Options FollowSymLinks', '              AllowOverride All', '              Require all granted', '              FallbackResource /index.php', '          </Directory>', '          ErrorLog /dev/stderr', '          CustomLog /dev/stdout combined', '      </VirtualHost>', '      APACHE_CONF', '      a2enmod rewrite >/dev/null', `      if [ ! -f ${containerDocroot}/index.php ]; then`, `        printf '%s\\n' '<?php echo "Devroost PHP example is running.";' > ${containerDocroot}/index.php`, '      fi', '      exec apache2-foreground', "    volumes:"
  ].join("\n");
}

export function renderPhpDocroot(devroostYaml: string, template: string, phpDocrootRaw?: string): string {
  if (!phpDocrootRaw || ["php-wordpress", "php-drupal"].includes(template)) return devroostYaml;
  if (!template.startsWith("php")) throw new Error("--php-docroot can only be used with PHP templates.");
  const phpDocroot = normalizeDocrootPath(phpDocrootRaw);
  if (template === "php") {
    const containerDocroot = phpDocroot === "." ? "/app" : `/app/${phpDocroot}`;
    return devroostYaml.replace(/command:\s*\|[\s\S]*?\n\s*volumes:/m, buildPhpBaseCommand(containerDocroot));
  }
  return devroostYaml
    .replace(/(\s+DocumentRoot\s+)\/app\/[^\s]+/, `$1/app/${phpDocroot}`)
    .replace(/(\s+<Directory\s+)\/app\/[^\s>]+(>)/, `$1/app/${phpDocroot}$2`);
}

export function renderDatabaseService(devroostYaml: string, db: DbType): string {
  const { serviceName, serviceYaml } = buildDatabaseServiceBlock(db);
  if (new RegExp(`^ {2}${serviceName}:`, "m").test(devroostYaml)) return devroostYaml;
  const insertion = /^(routes:|tasks:)/m.test(devroostYaml)
    ? devroostYaml.replace(/^(routes:|tasks:)/m, `${serviceYaml}\n$1`)
    : `${devroostYaml.trimEnd()}\n${serviceYaml}\n`;
  if (/^ {4}dependsOn:/m.test(insertion)) {
    return insertion.replace(/^( {4}dependsOn:(?:\n {6}- [^\n]+)*)/m, `$1\n      - ${serviceName}`);
  }
  const portsIndex = insertion.indexOf("\n    ports:");
  return portsIndex === -1 ? insertion : `${insertion.slice(0, portsIndex)}\n    dependsOn:\n      - ${serviceName}${insertion.slice(portsIndex)}`;
}

async function renderCandidates(options: PlanProjectUpgradeOptions, candidateRoot: string): Promise<void> {
  const assetRoot = resolveContained(options.stacksRoot, options.stack.assetPath, "stack asset path");
  for (const path of options.stack.devroostOwnedFiles) {
    const source = resolveContained(assetRoot, path, "Devroost-owned asset path");
    try { await access(source); } catch { throw new Error(`Missing Devroost-owned asset '${path}' for stack '${options.stack.id}'`); }
    const destination = resolveContained(candidateRoot, path, "candidate path");
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(source, destination);
  }
  if (options.stack.devroostOwnedFiles.includes("devroost.yaml")) {
    const path = resolve(candidateRoot, "devroost.yaml");
    let content = await readFile(path, "utf8");
    content = renderProjectName(content, options.manifest.renderInputs.projectName);
    content = renderPhpDocroot(content, options.stack.id, options.manifest.renderInputs.phpDocroot);
    for (const database of options.manifest.renderInputs.databases) {
      if (!["postgres", "mysql", "mariadb", "mongodb", "redis"].includes(database)) throw new Error(`Unknown stored database type '${database}'`);
      content = renderDatabaseService(content, database as DbType);
    }
    await writeFile(path, content, "utf8");
  }
}

export async function planProjectUpgrade(options: PlanProjectUpgradeOptions): Promise<ProjectUpgradePlan> {
  const compatibility = classifyProjectManifestStack(options.manifest, options.stack);
  if (compatibility.kind === "incompatible") {
    throw new Error(`Project manifest is incompatible with stack '${options.stack.id}': ${compatibility.reason}`);
  }
  await mkdir(resolve(options.projectRoot, ".devroost"), { recursive: true });
  const candidateRoot = await mkdtemp(resolve(options.projectRoot, ".devroost", "upgrade-candidate-"));
  try {
    for (const path of Object.keys(options.manifest.ownedFiles)) assertSafeRelativePath(path, "owned file path");
    for (const path of options.stack.devroostOwnedFiles) assertSafeRelativePath(path, "Devroost-owned asset path");
    await renderCandidates(options, candidateRoot);
    const files: ProjectUpgradeFilePlan[] = [];
    for (const path of Object.keys(options.manifest.ownedFiles).sort()) {
      if (!options.stack.devroostOwnedFiles.includes(path)) throw new Error(`Stack '${options.stack.id}' does not declare owned asset '${path}'`);
      const currentSha256 = await sha256File(resolveContained(options.projectRoot, path, "owned file path"));
      const candidatePath = resolveContained(candidateRoot, path, "candidate path");
      const candidateSha256 = await sha256File(candidatePath);
      if (!candidateSha256) throw new Error(`Missing Devroost-owned asset '${path}' for stack '${options.stack.id}'`);
      const baselineSha256 = options.manifest.ownedFiles[path].sha256;
      files.push({ path, state: currentSha256 === undefined ? "missing" : currentSha256 === baselineSha256 ? "unchanged" : "modified", ...(currentSha256 ? { currentSha256 } : {}), baselineSha256, candidateSha256, candidatePath });
    }
    return { projectRoot: resolve(options.projectRoot), candidateRoot, manifest: options.manifest, stack: options.stack, files };
  } catch (error) {
    await rm(candidateRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function applyProjectUpgrade(
  plan: ProjectUpgradePlan,
  options: ApplyProjectUpgradeOptions
): Promise<{ updated: string[]; skipped: string[] }> {
  const updated = plan.files.filter((file) => file.state !== "modified" || options.forceModified).map((file) => file.path);
  const skipped = plan.files.filter((file) => file.state === "modified" && !options.forceModified).map((file) => file.path);
  const devroostDir = await assertNoSymlinkPath(plan.projectRoot, ".devroost", "Devroost metadata path");
  const stageRoot = await mkdtemp(resolve(devroostDir, "upgrade-stage-"));
  try {
    for (const file of plan.files.filter((entry) => updated.includes(entry.path))) {
      const staged = resolveContained(stageRoot, file.path, "staged owned file path");
      await mkdir(dirname(staged), { recursive: true });
      await copyFile(file.candidatePath, staged);
      if (await sha256File(staged) !== file.candidateSha256) throw new Error(`Candidate hash changed for '${file.path}'`);
      const target = await assertNoSymlinkPath(plan.projectRoot, file.path, "owned file path");
      await mkdir(dirname(target), { recursive: true });
      await assertNoSymlinkPath(plan.projectRoot, file.path, "owned file path");
    }

    const nextManifest: LoomProjectManifestV2 = {
      ...plan.manifest,
      devroostVersion: packageJson.version,
      stack: {
        id: plan.stack.id,
        scaffoldVersion: plan.stack.scaffoldVersion,
        definitionVersion: plan.stack.definitionVersion
      },
      ownedFiles: { ...plan.manifest.ownedFiles }
    };
    for (const file of plan.files.filter((entry) => updated.includes(entry.path))) {
      const nextBaselinePath = baselinePath(file.path, file.candidateSha256);
      const stagedBaseline = resolveContained(stageRoot, nextBaselinePath, "staged baseline path");
      await mkdir(dirname(stagedBaseline), { recursive: true });
      await copyFile(file.candidatePath, stagedBaseline);
      nextManifest.ownedFiles[file.path] = { sha256: file.candidateSha256, baselinePath: nextBaselinePath };
    }
    const stagedManifest = resolve(stageRoot, ".devroost", "manifest.json");
    await mkdir(dirname(stagedManifest), { recursive: true });
    await writeFile(stagedManifest, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

    for (const file of plan.files.filter((entry) => updated.includes(entry.path))) {
      const target = await assertNoSymlinkPath(plan.projectRoot, file.path, "owned file path");
      await rename(resolveContained(stageRoot, file.path, "staged owned file path"), target);
    }
    for (const file of plan.files.filter((entry) => updated.includes(entry.path))) {
      const path = nextManifest.ownedFiles[file.path].baselinePath;
      const target = await assertNoSymlinkPath(plan.projectRoot, path, "baseline path");
      await mkdir(dirname(target), { recursive: true });
      await rename(resolveContained(stageRoot, path, "staged baseline path"), target);
    }
    const manifestTarget = await assertNoSymlinkPath(plan.projectRoot, ".devroost/manifest.json", "manifest path");
    await rename(stagedManifest, manifestTarget);
    return { updated, skipped };
  } finally {
    await Promise.all([
      rm(stageRoot, { recursive: true, force: true }),
      rm(plan.candidateRoot, { recursive: true, force: true })
    ]);
  }
}
