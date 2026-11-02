#!/usr/bin/env node
import { cac } from "cac";
import { existsSync } from "node:fs";
import { access, copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import { loadLoomProject } from "@loom/config";
import { formatStartupNotice, LoomOrchestrator } from "@loom/core";
import { runNamedTask } from "@loom/tasks";
import { detectInitTemplateSuggestion } from "./init-detect.js";
import { confirmProjectClean } from "./clean-prompt.js";
import { buildDatabaseServiceBlock } from "./database-service.js";
import { doctorExitCode, formatDoctorJson, formatDoctorResults } from "./doctor-output.js";
import {
  chooseInitDatabases,
  chooseInitImageOverrides,
  chooseInitTemplate,
  describeInitTemplate,
  initImageChoicesByTemplate,
  isValidDbType,
  supportedDbTypes,
  type DbType
} from "./init-prompt.js";
import { prepareInitTarget } from "./init-template.js";
import { classifyProjectManifestStack, loadProjectManifest, writeProjectManifest } from "./project-manifest.js";
import { applyProjectClean, planProjectClean, type ProjectCleanPlan } from "./project-clean.js";
import { runProjectDoctor } from "./project-doctor.js";
import { applyProjectUpgrade, planProjectUpgrade, renderPhpDocroot, renderProjectName } from "./project-upgrade.js";
import { findStackDefinition, listStackIds, type StackDefinition } from "./stacks.js";

const cli = cac("devroost");

function resolveStacksRoot(): string {
  const candidates = [
    resolve(fileURLToPath(new URL("./stacks", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../stacks", import.meta.url)))
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Devroost stack assets directory not found. Ensure the 'stacks/' directory exists and is readable.");
}

const stacksRoot = resolveStacksRoot();

function resolveStackSourceDir(stack: StackDefinition): string {
  const sourceDir = resolve(stacksRoot, stack.assetPath);
  const fromRoot = relative(stacksRoot, sourceDir);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\") || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe stack asset path '${stack.assetPath}' for '${stack.id}'.`);
  }
  if (existsSync(sourceDir)) return sourceDir;
  throw new Error(`Devroost stack assets for '${stack.id}' were not found.`);
}

const ignoredTemplateEntries = new Set([
  "node_modules",
  ".pnpm-store",
  ".turbo",
  ".devroost"
]);

const topLevelIgnoredTemplateEntries = new Set([
  "data",
  "dist",
  ".next"
]);

const phpDocrootIgnoredTemplates = new Set(["php-wordpress", "php-drupal"]);

function formatBytes(bytes: number): string {
  return `${bytes} B`;
}

function renderCleanPlan(plan: ProjectCleanPlan): void {
  process.stdout.write("Generated paths:\n");
  for (const item of plan.items) {
    process.stdout.write(`  ${item.path} [${item.category}] ${item.exists ? formatBytes(item.bytes) : "missing"}\n`);
  }
  if (plan.items.length === 0) process.stdout.write("  (none)\n");
  process.stdout.write(`Total: ${formatBytes(plan.totalBytes)}\n`);
}

function withErrorHandling<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<void>) {
  return async (...args: TArgs) => {
    try {
      await fn(...args);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  };
}

async function bootstrapProject(configPath?: string): Promise<LoomOrchestrator> {
  const project = await loadLoomProject(configPath);
  process.chdir(project.projectRoot);
  return new LoomOrchestrator(project.config, project.projectRoot);
}

async function ensureEnvFileFromExample(targetDir: string): Promise<void> {
  const envExamplePath = resolve(targetDir, ".env.example");
  const envPath = resolve(targetDir, ".env");

  try {
    await access(envExamplePath);
  } catch {
    return;
  }

  try {
    await access(envPath);
    return;
  } catch {
    await copyFile(envExamplePath, envPath);
    process.stdout.write(`Created ${envPath} from .env.example\n`);
  }
}

function isPhpTemplate(template: string): boolean {
  return template.startsWith("php");
}

function resolveInitTargetDir(template: string, requestedDir?: string): string {
  const dir = requestedDir ?? ".";
  if (template.startsWith("db-") && (dir === "." || dir === "./")) {
    return resolve(process.cwd(), "db");
  }

  return resolve(process.cwd(), dir);
}

function validateInitOptions(template: string, phpDocroot?: string): void {
  if (!phpDocroot) {
    return;
  }

  if (!isPhpTemplate(template)) {
    throw new Error("--php-docroot can only be used with PHP templates.");
  }
}

function resolvePhpDocrootOption(template: string, phpDocroot?: string): string | undefined {
  if (!isPhpTemplate(template)) {
    return phpDocroot;
  }

  if (template === "php-symfony") {
    return phpDocroot ?? "public";
  }

  return phpDocroot ?? ".";
}

async function copyTemplate(sourceDir: string, targetDir: string, force: boolean): Promise<void> {
  await cp(sourceDir, targetDir, {
    recursive: true,
    force,
    filter: (sourcePath) => {
      const entryName = sourcePath.split("/").pop() ?? "";
      if (ignoredTemplateEntries.has(entryName)) {
        return false;
      }
      const relativePath = sourcePath.slice(sourceDir.length + 1);
      if (topLevelIgnoredTemplateEntries.has(entryName) && relativePath.split("/").length === 1) {
        return false;
      }
      return true;
    }
  });
}

async function copyTemplateEntries(
  sourceDir: string,
  targetDir: string,
  entries: string[],
  force: boolean
): Promise<void> {
  for (const entry of entries) {
    await cp(resolve(sourceDir, entry), resolve(targetDir, entry), {
      recursive: true,
      force
    });
  }
}

async function copyTemplateEntriesIfMissing(
  sourceDir: string,
  targetDir: string,
  entries: string[]
): Promise<void> {
  for (const entry of entries) {
    const targetPath = resolve(targetDir, entry);
    try {
      await access(targetPath);
      continue;
    } catch {
      await cp(resolve(sourceDir, entry), targetPath, {
        recursive: true,
        force: false
      });
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeProjectToken(raw: string): string {
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "project";
}

function deriveProjectName(targetDir: string): string {
  const targetName = basename(targetDir) === "db" ? basename(resolve(targetDir, "..")) : basename(targetDir);
  return `devroost-${normalizeProjectToken(targetName)}`;
}

async function applyProjectName(targetDir: string): Promise<void> {
  const devroostPath = resolve(targetDir, "devroost.yaml");
  const projectName = deriveProjectName(targetDir);
  const devroostYaml = await readFile(devroostPath, "utf8");
  const updatedLoomYaml = renderProjectName(devroostYaml, projectName);

  if (updatedLoomYaml !== devroostYaml) {
    await writeFile(devroostPath, updatedLoomYaml, "utf8");
  }
}

function replaceEnvVariable(content: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, `${key}=${value}`) : content;
}

function parseEnvAssignments(optionValue: string | string[] | undefined): Record<string, string> {
  if (!optionValue) {
    return {};
  }

  const values = Array.isArray(optionValue) ? optionValue : [optionValue];
  const assignments: Record<string, string> = {};

  for (const value of values) {
    const separatorIndex = value.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid --image value '${value}'. Use KEY=VALUE.`);
    }

    const key = value.slice(0, separatorIndex).trim();
    const assignedValue = value.slice(separatorIndex + 1).trim();
    if (!key || !assignedValue) {
      throw new Error(`Invalid --image value '${value}'. Use KEY=VALUE.`);
    }

    assignments[key] = assignedValue;
  }

  return assignments;
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    values[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
  }

  return values;
}

function hasEnvVariable(content: string, key: string): boolean {
  const pattern = new RegExp(`^${key}=`, "m");
  return pattern.test(content);
}

async function applyPhpDocroot(targetDir: string, template: string, phpDocrootRaw?: string): Promise<void> {
  if (!phpDocrootRaw) {
    return;
  }

  if (!isPhpTemplate(template)) {
    throw new Error("--php-docroot can only be used with PHP templates.");
  }

  if (phpDocrootIgnoredTemplates.has(template)) {
    process.stdout.write(
      `Ignoring --php-docroot for '${template}' (template manages docroot internally).\n`
    );
    return;
  }

  const devroostPath = resolve(targetDir, "devroost.yaml");
  const devroostYaml = renderPhpDocroot(await readFile(devroostPath, "utf8"), template, phpDocrootRaw);
  const displayedDocroot = phpDocrootRaw.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") || ".";

  await writeFile(devroostPath, devroostYaml, "utf8");
  process.stdout.write(`Set PHP docroot to '${displayedDocroot}' in ${devroostPath}\n`);
}

function replaceYamlEnvVariable(content: string, key: string, value: string): string {
  const pattern = new RegExp(`(^\\s*${key}:\\s*).*$`, "m");
  return content.replace(pattern, (_match, group) => `${group}${value}`);
}

function serviceNameForDbType(devroostYaml: string, dbType: string): string {
  const lines = devroostYaml.split("\n");
  let currentService: string | null = null;
  for (const line of lines) {
    const serviceMatch = /^ {2}([\w-]+):/.exec(line);
    if (serviceMatch) {
      currentService = serviceMatch[1];
    }
    const typeMatch = /^ {4}type:\s*(\S+)/.exec(line);
    if (typeMatch && typeMatch[1].toLowerCase() === dbType.toLowerCase() && currentService) {
      return currentService;
    }
  }
  return dbType;
}

async function customizeDbTemplateCredentials(targetDir: string): Promise<void> {
  const envPath = resolve(targetDir, ".env");
  const devroostConfigPath = resolve(targetDir, "devroost.yaml");

  let envContent: string;
  let devroostYamlContent: string;

  try {
    envContent = await readFile(envPath, "utf8");
    devroostYamlContent = await readFile(devroostConfigPath, "utf8");
  } catch {
    return;
  }

  const targetName = basename(targetDir) === "db" ? basename(resolve(targetDir, "..")) : basename(targetDir);
  const token = normalizeProjectToken(targetName);
  const suffix = randomBytes(3).toString("hex");

  const appUser = `loom_${token}_${suffix}`.slice(0, 30);
  const appDb = `loom_${token}`.slice(0, 30);
  const appPassword = `Devroost!${suffix}9aA`;
  const rootPassword = `Root!${suffix}9aA`;
  const mssqlPassword = `Devroost${suffix}!9aA`;

  const replacements: Record<string, string> = {
    MYSQL_ROOT_PASSWORD: rootPassword,
    MYSQL_DATABASE: appDb,
    MYSQL_USER: appUser,
    MYSQL_PASSWORD: appPassword,
    MARIADB_ROOT_PASSWORD: rootPassword,
    MARIADB_DATABASE: appDb,
    MARIADB_USER: appUser,
    MARIADB_PASSWORD: appPassword,
    POSTGRES_USER: appUser,
    POSTGRES_PASSWORD: appPassword,
    POSTGRES_DB: appDb,
    MONGO_INITDB_ROOT_USERNAME: appUser,
    MONGO_INITDB_ROOT_PASSWORD: appPassword,
    MONGO_INITDB_DATABASE: appDb,
    MSSQL_SA_PASSWORD: mssqlPassword
  };

  for (const [key, value] of Object.entries(replacements)) {
    envContent = replaceEnvVariable(envContent, key, value);
    devroostYamlContent = replaceYamlEnvVariable(devroostYamlContent, key, value);
  }

  // WordPress reads its own env vars from .env via devroostWordPressEnv() in wp-config.php
  if (hasEnvVariable(envContent, "WORDPRESS_DB_HOST")) {
    envContent = replaceEnvVariable(envContent, "WORDPRESS_DB_NAME", appDb);
    envContent = replaceEnvVariable(envContent, "WORDPRESS_DB_USER", appUser);
    envContent = replaceEnvVariable(envContent, "WORDPRESS_DB_PASSWORD", appPassword);

    const wpDbHost = serviceNameForDbType(devroostYamlContent, "mysql") || "db";
    envContent = replaceEnvVariable(envContent, "WORDPRESS_DB_HOST", `${wpDbHost}:3306`);
  }

  const mysqlHost = serviceNameForDbType(devroostYamlContent, "mysql");
  const mariadbHost = serviceNameForDbType(devroostYamlContent, "mariadb");
  const postgresHost = serviceNameForDbType(devroostYamlContent, "postgres");
  const mongoHost = serviceNameForDbType(devroostYamlContent, "mongodb");
  const mssqlHost = serviceNameForDbType(devroostYamlContent, "sqlserver");

  const appUserEnc = encodeURIComponent(appUser);
  const appPasswordEnc = encodeURIComponent(appPassword);
  const mssqlPasswordEnc = encodeURIComponent(mssqlPassword);

  const mysqlUrl = `mysql://${appUserEnc}:${appPasswordEnc}@${mysqlHost}:3306/${appDb}`;
  const mariadbUrl = `mysql://${appUserEnc}:${appPasswordEnc}@${mariadbHost}:3306/${appDb}`;
  const postgresUrl = `postgresql://${appUserEnc}:${appPasswordEnc}@${postgresHost}:5432/${appDb}`;
  const mongoUrl = `mongodb://${appUserEnc}:${appPasswordEnc}@${mongoHost}:27017/${appDb}?authSource=admin`;
  const mssqlUrl = `sqlserver://sa:${mssqlPasswordEnc}@${mssqlHost}:1433;encrypt=false`;

  if (hasEnvVariable(envContent, "DATABASE_URL")) {
    if (hasEnvVariable(envContent, "POSTGRES_USER")) {
      envContent = replaceEnvVariable(envContent, "DATABASE_URL", postgresUrl);
    } else if (hasEnvVariable(envContent, "MYSQL_USER")) {
      envContent = replaceEnvVariable(envContent, "DATABASE_URL", mysqlUrl);
    } else if (hasEnvVariable(envContent, "MARIADB_USER")) {
      envContent = replaceEnvVariable(envContent, "DATABASE_URL", mariadbUrl);
    } else if (hasEnvVariable(envContent, "MONGO_INITDB_ROOT_USERNAME")) {
      envContent = replaceEnvVariable(envContent, "DATABASE_URL", mongoUrl);
    } else if (hasEnvVariable(envContent, "MSSQL_SA_PASSWORD")) {
      envContent = replaceEnvVariable(envContent, "DATABASE_URL", mssqlUrl);
    }
  }

  envContent = replaceEnvVariable(envContent, "MYSQL_URL", mysqlUrl);
  envContent = replaceEnvVariable(envContent, "MARIADB_URL", mariadbUrl);
  envContent = replaceEnvVariable(envContent, "POSTGRES_URL", postgresUrl);
  envContent = replaceEnvVariable(envContent, "MONGODB_URL", mongoUrl);
  envContent = replaceEnvVariable(envContent, "MSSQL_URL", mssqlUrl);

  await writeFile(envPath, envContent, "utf8");
  await writeFile(devroostConfigPath, devroostYamlContent, "utf8");
  process.stdout.write(`Generated project-specific DB credentials in ${envPath}\n`);
}

async function applyRuntimeImageSelections(
  targetDir: string,
  template: string,
  imageAssignments: Record<string, string>
): Promise<void> {
  const envPath = resolve(targetDir, ".env");

  let envContent: string;
  try {
    envContent = await readFile(envPath, "utf8");
  } catch {
    return;
  }

  const currentValues = parseEnvFile(envContent);
  const chosenImages = { ...imageAssignments };

  const hasInteractiveChoices = (initImageChoicesByTemplate[template] ?? []).length > 0;
  if (hasInteractiveChoices && process.stdin.isTTY) {
    const prompted = await chooseInitImageOverrides(
      template,
      { ...currentValues, ...chosenImages },
      Object.keys(chosenImages)
    );
    Object.assign(chosenImages, prompted);
  }

  if (Object.keys(chosenImages).length === 0) {
    return;
  }

  for (const [key, value] of Object.entries(chosenImages)) {
    envContent = replaceEnvVariable(envContent, key, value);
  }

  await writeFile(envPath, envContent, "utf8");
  process.stdout.write(`Configured runtime image selections in ${envPath}\n`);
}

async function applyDatabaseService(targetDir: string, db: DbType): Promise<void> {
  const devroostPath = resolve(targetDir, "devroost.yaml");
  let devroostYaml: string;
  try {
    devroostYaml = await readFile(devroostPath, "utf8");
  } catch {
    throw new Error(`No devroost.yaml found in '${targetDir}'. Run 'devroost init' first.`);
  }

  const { serviceName, serviceYaml, envVars } = buildDatabaseServiceBlock(db);

  const serviceAlreadyExists = new RegExp(`^ {2}${serviceName}:`, "m").test(devroostYaml);
  if (serviceAlreadyExists) {
    process.stdout.write(`Service '${serviceName}' already exists in devroost.yaml — skipping.\n`);
    return;
  }

  // Inject db service block at the end of the services section (before routes/tasks/end)
  const servicesInsertPattern = /^(routes:|tasks:)/m;
  if (servicesInsertPattern.test(devroostYaml)) {
    devroostYaml = devroostYaml.replace(servicesInsertPattern, `${serviceYaml}\n$1`);
  } else {
    devroostYaml = devroostYaml.trimEnd() + `\n${serviceYaml}\n`;
  }

  // Add serviceName to dependsOn, extending an existing block or inserting a new one
  if (/^ {4}dependsOn:/m.test(devroostYaml)) {
    devroostYaml = devroostYaml.replace(/^( {4}dependsOn:(?:\n {6}- [^\n]+)*)(?!\n {6}- ${serviceName})/m, `$1\n      - ${serviceName}`);
  } else {
    const portsIdx = devroostYaml.indexOf('\n    ports:');
    if (portsIdx !== -1) {
      devroostYaml = devroostYaml.slice(0, portsIdx) + `\n    dependsOn:\n      - ${serviceName}` + devroostYaml.slice(portsIdx);
    }
  }

  await writeFile(devroostPath, devroostYaml, "utf8");
  process.stdout.write(`Added '${serviceName}' database service to ${devroostPath}\n`);

  // Append env vars to .env if present
  const envPath = resolve(targetDir, ".env");
  try {
    let envContent = await readFile(envPath, "utf8");
    let changed = false;
    for (const [key, value] of Object.entries(envVars)) {
      if (!hasEnvVariable(envContent, key)) {
        envContent = envContent.trimEnd() + `\n${key}=${value}\n`;
        changed = true;
      }
    }
    if (changed) {
      await writeFile(envPath, envContent, "utf8");
      process.stdout.write(`Added database connection variables to ${envPath}\n`);
    }
  } catch {
    // no .env yet — skip
  }
}

cli
  .command("init [template]", "Initialize a sample project in a target directory")
  .option("--dir <path>", "Target directory", { default: "." })
  .option("--blank-template", "Delete existing files and initialize a clean template copy", { default: false })
  .option("--php-docroot <path>", "PHP docroot path inside project (php/php-symfony templates)")
  .option("--image <key=value>", "Override a template image variable during init (repeatable)")
  .option("--db <type>", `Add a database service, repeatable (${supportedDbTypes.join(", ")})`)
  .action(
    withErrorHandling(async (template: string | undefined, options: { dir?: string; blankTemplate?: boolean; phpDocroot?: string; image?: string | string[]; db?: string | string[] }) => {
      const selectedTemplate = template ?? (await chooseInitTemplate(
        await detectInitTemplateSuggestion(process.cwd())
      ));
      const stack = findStackDefinition(selectedTemplate);
      if (!stack) {
        const available = listStackIds().join(", ");
        throw new Error(`Unknown template '${selectedTemplate}'. Available templates: ${available}`);
      }

      process.stdout.write(`Initializing '${selectedTemplate}': ${describeInitTemplate(selectedTemplate)}\n`);

      validateInitOptions(selectedTemplate, options.phpDocroot);
      const effectivePhpDocroot = resolvePhpDocrootOption(selectedTemplate, options.phpDocroot);

      const sourceDir = resolveStackSourceDir(stack);
      const targetDir = resolveInitTargetDir(selectedTemplate, options.dir);

      await mkdir(targetDir, { recursive: true });

      const initPreparation = await prepareInitTarget(stack, targetDir, options.blankTemplate ?? false);

      if (initPreparation.templateEntriesToUpdate) {
        await copyTemplateEntries(
          sourceDir,
          targetDir,
          initPreparation.templateEntriesToUpdate,
          (options.blankTemplate ?? false) || initPreparation.overwriteTemplateFiles
        );
      } else {
        await copyTemplate(sourceDir, targetDir, (options.blankTemplate ?? false) || initPreparation.overwriteTemplateFiles);
      }

      if (initPreparation.templateEntriesToCreateIfMissing) {
        await copyTemplateEntriesIfMissing(
          sourceDir,
          targetDir,
          initPreparation.templateEntriesToCreateIfMissing
        );
      }

      await applyProjectName(targetDir);
      await applyPhpDocroot(targetDir, selectedTemplate, effectivePhpDocroot);

      await ensureEnvFileFromExample(targetDir);
      await applyRuntimeImageSelections(targetDir, selectedTemplate, parseEnvAssignments(options.image));

      let dbsToAdd: string[] = [];
      if (options.db) {
        dbsToAdd = Array.isArray(options.db) ? options.db : [options.db];
      } else if (process.stdin.isTTY && !selectedTemplate.startsWith("db-")) {
        const selected = await chooseInitDatabases();
        dbsToAdd = selected;
      }

      for (const dbType of dbsToAdd) {
        if (!isValidDbType(dbType)) {
          throw new Error(`Unknown database type '${dbType}'. Supported: ${supportedDbTypes.join(", ")}`);
        }
        await applyDatabaseService(targetDir, dbType);
      }

      if (dbsToAdd.length > 0 || selectedTemplate.startsWith("db-")) {
        await customizeDbTemplateCredentials(targetDir);
      }
      await writeProjectManifest(targetDir, packageJson.version, stack, stack.devroostOwnedFiles, {
        projectName: deriveProjectName(targetDir),
        ...(effectivePhpDocroot === undefined ? {} : { phpDocroot: effectivePhpDocroot }),
        databases: [...dbsToAdd].sort(),
        adopted: false
      });
      process.stdout.write(`Initialized '${selectedTemplate}' in ${targetDir}\n`);
      process.stdout.write(formatStartupNotice());
      process.stdout.write(`Next: cd ${targetDir} && devroost start\n`);
    })
  );

cli
  .command("adopt [stack]", "Configure an existing local project without replacing application files")
  .option("--dir <path>", "Existing project directory", { default: "." })
  .action(
    withErrorHandling(async (requestedStack: string | undefined, options: { dir?: string }) => {
      const targetDir = resolve(process.cwd(), options.dir ?? ".");
      const selectedStack = requestedStack ?? await detectInitTemplateSuggestion(targetDir);

      if (!selectedStack) {
        throw new Error("Unable to detect a stack for this project. Retry with 'devroost adopt <stack>'.");
      }

      const stack = findStackDefinition(selectedStack);
      if (!stack) {
        throw new Error(`Unknown stack '${selectedStack}'. Available stacks: ${listStackIds().join(", ")}`);
      }

      const devroostConfigPath = resolve(targetDir, "devroost.yaml");
      if (await fileExists(devroostConfigPath)) {
        throw new Error(`Project already contains '${devroostConfigPath}'. Adoption will not overwrite Devroost configuration.`);
      }

      const sourceDir = resolveStackSourceDir(stack);
      const ownedFiles = ["devroost.yaml"];
      await copyFile(resolve(sourceDir, "devroost.yaml"), devroostConfigPath);

      const sourceEnvExample = resolve(sourceDir, ".env.example");
      const targetEnvExample = resolve(targetDir, ".env.example");
      if (!(await fileExists(targetEnvExample)) && await fileExists(sourceEnvExample)) {
        await copyFile(sourceEnvExample, targetEnvExample);
        ownedFiles.push(".env.example");
      }

      await applyProjectName(targetDir);
      await writeProjectManifest(targetDir, packageJson.version, stack, ownedFiles, {
        projectName: deriveProjectName(targetDir),
        databases: [],
        adopted: true
      });

      process.stdout.write(`Adopted '${selectedStack}' in ${targetDir}\n`);
      process.stdout.write(`Next: cd ${targetDir} && devroost start\n`);
    })
  );

cli
  .command("upgrade", "Update only Devroost-owned project files")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--force-modified", "Replace locally modified Devroost-owned files", { default: false })
  .option("--initialize-baseline", "Migrate a v1 manifest using current Devroost-owned files", { default: false })
  .action(
    withErrorHandling(async (options: { config?: string; forceModified?: boolean; initializeBaseline?: boolean }) => {
      const configPath = resolve(process.cwd(), options.config ?? "devroost.yaml");
      const projectRoot = dirname(configPath);
      const loaded = await loadProjectManifest(projectRoot);

      if (loaded.kind === "missing") {
        throw new Error(`No Devroost project manifest found in '${projectRoot}'. Run 'devroost init' or 'devroost adopt' first.`);
      }

      const stackId = loaded.manifest.stack.id;
      const stack = findStackDefinition(stackId);
      if (!stack) {
        throw new Error(`Unknown stack '${stackId}' in Devroost project manifest. Available stacks: ${listStackIds().join(", ")}`);
      }
      const compatibility = classifyProjectManifestStack(loaded.manifest, stack);
      if (compatibility.kind === "incompatible") {
        throw new Error(`Project manifest is incompatible with stack '${stackId}': ${compatibility.reason}`);
      }

      if (loaded.kind === "migration-required") {
        if (!options.initializeBaseline) {
          throw new Error("This project uses a v1 Devroost manifest. Run 'devroost upgrade --initialize-baseline' before upgrading files.");
        }
        const devroostYaml = await readFile(configPath, "utf8");
        const projectName = /^name:\s*(.+)$/m.exec(devroostYaml)?.[1]?.trim() || deriveProjectName(projectRoot);
        await writeProjectManifest(projectRoot, packageJson.version, stack, Object.keys(loaded.manifest.ownedFiles), {
          projectName,
          databases: [],
          adopted: false
        });
        process.stdout.write(`Initialized upgrade baseline for '${stackId}' in ${projectRoot}. No project files were replaced.\n`);
        return;
      }

      if (options.initializeBaseline) {
        throw new Error("The project already has an upgrade-safe v2 manifest; --initialize-baseline is not needed.");
      }

      const plan = await planProjectUpgrade({ projectRoot, stacksRoot, manifest: loaded.manifest, stack });
      for (const file of plan.files) {
        if (file.state === "modified" && !options.forceModified) {
          process.stdout.write(`modified ${file.path} -> skipped (use --force-modified to replace)\n`);
        } else if (file.currentSha256 === file.candidateSha256) {
          process.stdout.write(`${file.state} ${file.path} -> already current\n`);
        } else {
          process.stdout.write(`${file.state} ${file.path} -> update available\n`);
        }
      }

      const result = await applyProjectUpgrade(plan, { forceModified: options.forceModified ?? false });
      process.stdout.write(`Upgrade complete: ${result.updated.length} updated, ${result.skipped.length} skipped.\n`);
      if (result.skipped.length > 0) process.exitCode = 1;
    })
  );

cli
  .command("doctor", "Diagnose project and host compatibility")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--json", "Print structured JSON results", { default: false })
  .action(
    withErrorHandling(async (options: { config?: string; json?: boolean }) => {
      const configPath = resolve(process.cwd(), options.config ?? "devroost.yaml");
      const project = await loadLoomProject(configPath);
      const manifest = await loadProjectManifest(project.projectRoot);
      const stack = manifest.kind === "missing" ? undefined : findStackDefinition(manifest.manifest.stack.id);
      const results = await runProjectDoctor({
        projectRoot: project.projectRoot,
        config: project.config,
        manifest,
        stack
      });

      if (options.json) process.stdout.write(formatDoctorJson(results));
      else process.stdout.write(formatDoctorResults(results));
      process.exitCode = doctorExitCode(results);
    })
  );

cli
  .command("clean", "Remove stack-declared generated paths")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--force", "Run without interactive confirmation", { default: false })
  .option("--dry-run", "Preview without removing paths", { default: false })
  .action(
    withErrorHandling(async (options: { config?: string; force?: boolean; dryRun?: boolean }) => {
      const configPath = resolve(process.cwd(), options.config ?? "devroost.yaml");
      const project = await loadLoomProject(configPath);
      const loaded = await loadProjectManifest(project.projectRoot);
      if (loaded.kind === "missing") {
        throw new Error(`No Devroost project manifest found in '${project.projectRoot}'. Run 'devroost init' or 'devroost adopt' first.`);
      }
      if (loaded.kind === "migration-required") {
        throw new Error("This project uses a v1 Devroost manifest. Run 'devroost upgrade --initialize-baseline' before cleaning.");
      }
      const stack = findStackDefinition(loaded.manifest.stack.id);
      if (!stack) {
        throw new Error(`Unknown stack '${loaded.manifest.stack.id}' in Devroost project manifest. Available stacks: ${listStackIds().join(", ")}`);
      }

      const plan = await planProjectClean({ projectRoot: project.projectRoot, stack, manifest: loaded.manifest });
      renderCleanPlan(plan);
      if (options.dryRun) return;
      if (!options.force) {
        if (!process.stdin.isTTY) throw new Error("Cleanup requires an interactive terminal or the explicit --force option.");
        if (!(await confirmProjectClean())) {
          process.stdout.write("Cleanup cancelled.\n");
          return;
        }
      }
      const result = await applyProjectClean(plan);
      process.stdout.write(`Cleanup complete: ${result.removed.length} removed, ${result.missing.length} missing.\n`);
    })
  );

cli
  .command("start", "Start Devroost project services")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--recreate", "Remove existing project containers before starting", { default: false })
  .action(
    withErrorHandling(async (options: { config?: string; recreate?: boolean }) => {
      const orchestrator = await bootstrapProject(options.config);
      await orchestrator.start({ recreate: options.recreate ?? false });
    })
  );

cli
  .command("stop", "Stop Devroost project services")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .action(
    withErrorHandling(async (options: { config?: string }) => {
      const orchestrator = await bootstrapProject(options.config);
      await orchestrator.stop();
    })
  );

cli
  .command("restart", "Restart Devroost project services")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--recreate", "Remove existing project containers before starting again", { default: false })
  .action(
    withErrorHandling(async (options: { config?: string; recreate?: boolean }) => {
      const orchestrator = await bootstrapProject(options.config);
      await orchestrator.restart({ recreate: options.recreate ?? false });
    })
  );

cli
  .command("status", "Show project and runtime status")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .action(
    withErrorHandling(async (options: { config?: string }) => {
      const orchestrator = await bootstrapProject(options.config);
      const status = await orchestrator.status();
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    })
  );

cli
  .command("ps", "List project containers")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .action(
    withErrorHandling(async (options: { config?: string }) => {
      const orchestrator = await bootstrapProject(options.config);
      const containers = await orchestrator.ps();
      process.stdout.write(`${JSON.stringify(containers, null, 2)}\n`);
    })
  );

cli
  .command("test", "Run test task from Devroost config")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--task <name>", "Task name", { default: "test" })
  .action(
    withErrorHandling(async (options: { config?: string; task?: string }) => {
      const taskName = options.task ?? "test";
      const orchestrator = await bootstrapProject(options.config);
      await runNamedTask(orchestrator, taskName);
    })
  );

cli
  .command("logs <service>", "Show service logs")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--follow", "Follow logs", { default: true })
  .action(
    withErrorHandling(async (service: string, options: { config?: string; follow?: boolean }) => {
      const orchestrator = await bootstrapProject(options.config);
      await orchestrator.logs(service, options.follow ?? true);
    })
  );

cli
  .command("exec <service> [...cmd]", "Exec command in service container")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .action(
    withErrorHandling(async (service: string, cmd: string[], options: { config?: string }) => {
      const orchestrator = await bootstrapProject(options.config);
      const passthroughIndex = process.argv.indexOf("--");
      const passthrough = passthroughIndex >= 0 ? process.argv.slice(passthroughIndex + 1) : [];
      await orchestrator.exec(service, passthroughIndex >= 0 ? passthrough : cmd);
    })
  );

cli
  .command("backup [service]", "Create backup file(s) for database services")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .option("--all", "Backup all supported database services in devroost.yaml", { default: false })
  .option("--output <path>", "Output file path (defaults to .devroost/backups/<project>-<service>-<timestamp>.*)")
  .action(
    withErrorHandling(async (service: string | undefined, options: { config?: string; output?: string; all?: boolean }) => {
      const orchestrator = await bootstrapProject(options.config);
      if (options.all) {
        const backups = await orchestrator.backupAll();
        for (const backup of backups) {
          process.stdout.write(`Backup created [${backup.service}]: ${backup.path}\n`);
        }
        return;
      }

      if (!service) {
        throw new Error("Service name is required unless --all is provided.");
      }

      const output = await orchestrator.backup(service, options.output);
      process.stdout.write(`Backup created: ${output}\n`);
    })
  );

cli
  .command("restore <service> <input>", "Restore a backup file into a supported database service")
  .option("--config <path>", "Path to Devroost config", { default: "devroost.yaml" })
  .action(
    withErrorHandling(async (service: string, input: string, options: { config?: string }) => {
      const orchestrator = await bootstrapProject(options.config);
      const restoredFrom = await orchestrator.restore(service, input);
      process.stdout.write(`Restore completed [${service}]: ${restoredFrom}\n`);
    })
  );

cli.help();
cli.version(packageJson.version);

cli.parse(process.argv, { run: false });
await cli.runMatchedCommand();
