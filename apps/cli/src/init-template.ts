import { spawn } from "node:child_process";
import { access, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { buildRegistryLoginHint, isImageUnavailableError, isRegistryAuthError } from "@loom/runtime-podman";
import { findStackDefinition, type StackDefinition } from "./stacks.js";

interface InitPreparationDependencies {
  directoryHasFiles?: (path: string) => Promise<boolean>;
  fileExists?: (path: string) => Promise<boolean>;
  readTextFile?: (path: string) => Promise<string>;
  runDrupalCreateProject?: (targetDir: string) => Promise<void>;
  runWordPressCreateProject?: (targetDir: string) => Promise<void>;
  runRailsCreateProject?: (targetDir: string) => Promise<void>;
  runRailsHotwireCreateProject?: (targetDir: string) => Promise<void>;
  runSymfonyCreateProject?: (targetDir: string) => Promise<void>;
  clearDirectory?: (path: string) => Promise<void>;
}

interface InitPreparationResult {
  overwriteTemplateFiles: boolean;
  templateEntriesToUpdate?: string[];
  templateEntriesToCreateIfMissing?: string[];
}

interface CreateProjectDependencies {
  runCommand?: (command: string, args: string[], cwd: string) => Promise<void>;
}

type DrupalCreateProjectDependencies = CreateProjectDependencies;
type WordPressCreateProjectDependencies = CreateProjectDependencies;
type RailsCreateProjectDependencies = CreateProjectDependencies;
type SymfonyCreateProjectDependencies = CreateProjectDependencies;

async function directoryHasFiles(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function clearDirectoryContents(path: string): Promise<void> {
  const entries = await readdir(path);
  const results = await Promise.allSettled(entries.map((entry) => rm(resolve(path, entry), { recursive: true, force: true })));
  const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failures.length > 0) {
    const messages = failures.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; ");
    throw new Error(`Failed to clear ${failures.length} entry(ies) in '${path}': ${messages}`);
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

async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error: unknown) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Command '${command}' failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBootstrapError(stackId: StackDefinition["id"], context: string, image: string, error: unknown): Error {
  const detail = errorMessage(error).trim() || "unknown error";
  if (isRegistryAuthError(detail)) {
    return new Error(
      `Failed to initialize '${stackId}' (${context}) because image '${image}' requires registry access or authentication: ${detail}${buildRegistryLoginHint(image)}`
    );
  }

  if (isImageUnavailableError(detail)) {
    return new Error(
      `Failed to initialize '${stackId}' (${context}) because image '${image}' is not available or could not be pulled: ${detail}`
    );
  }

  return new Error(`Failed to initialize '${stackId}' (${context}): ${detail}`);
}

function requiredStackDefinition(id: string): StackDefinition {
  const definition = findStackDefinition(id);
  if (!definition) throw new Error(`Unknown bootstrap stack '${id}'.`);
  return definition;
}

function renderGeneratorCommand(definition: StackDefinition): string[] {
  if (definition.generator.kind !== "command") throw new Error(`Stack '${definition.id}' does not declare a command generator.`);
  const generator = definition.generator;
  return generator.command.map((argument) => argument
    .replaceAll("{package}", generator.package)
    .replaceAll("{version}", generator.version));
}

export async function runStackGeneratorWithDependencies(
  definition: StackDefinition,
  targetDir: string,
  dependencies: CreateProjectDependencies = {}
): Promise<void> {
  if (definition.generator.kind !== "command") throw new Error(`Stack '${definition.id}' does not declare a command generator.`);
  const execute = dependencies.runCommand ?? runCommand;
  const execution = definition.generator.execution;
  const podmanArgs = [
    "run",
    "--rm",
    ...(process.platform === "linux" ? ["--userns=keep-id"] : []),
    ...execution.environment.flatMap(({ name, value }) => ["-e", `${name}=${value}`]),
    "-v",
    `${targetDir}:${execution.mountTarget}`,
    ...(execution.workdir === undefined ? [] : ["-w", execution.workdir]),
    definition.generator.image,
    ...renderGeneratorCommand(definition)
  ];

  try {
    await execute("podman", podmanArgs, targetDir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(
        `Podman is required to initialize '${definition.id}'. Install Podman and retry 'devroost init ${definition.id}'.`
      );
    }

    throw formatBootstrapError(
      definition.id,
      execution.context,
      definition.generator.image,
      error
    );
  }
}

export async function runDrupalCreateProjectWithDependencies(targetDir: string, dependencies: DrupalCreateProjectDependencies = {}): Promise<void> {
  return runStackGeneratorWithDependencies(requiredStackDefinition("php-drupal"), targetDir, dependencies);
}
export async function runDrupalCreateProject(targetDir: string): Promise<void> { return runDrupalCreateProjectWithDependencies(targetDir); }

export async function runWordPressCreateProjectWithDependencies(targetDir: string, dependencies: WordPressCreateProjectDependencies = {}): Promise<void> {
  return runStackGeneratorWithDependencies(requiredStackDefinition("php-wordpress"), targetDir, dependencies);
}
export async function runWordPressCreateProject(targetDir: string): Promise<void> { return runWordPressCreateProjectWithDependencies(targetDir); }

export async function runRailsCreateProjectWithDependencies(targetDir: string, dependencies: RailsCreateProjectDependencies = {}): Promise<void> {
  return runStackGeneratorWithDependencies(requiredStackDefinition("rails7"), targetDir, dependencies);
}
export async function runRailsCreateProject(targetDir: string): Promise<void> { return runRailsCreateProjectWithDependencies(targetDir); }

export async function runRailsHotwireCreateProjectWithDependencies(targetDir: string, dependencies: RailsCreateProjectDependencies = {}): Promise<void> {
  return runStackGeneratorWithDependencies(requiredStackDefinition("rails7-hotwire"), targetDir, dependencies);
}
export async function runRailsHotwireCreateProject(targetDir: string): Promise<void> { return runRailsHotwireCreateProjectWithDependencies(targetDir); }

export async function runSymfonyCreateProjectWithDependencies(targetDir: string, dependencies: SymfonyCreateProjectDependencies = {}): Promise<void> {
  return runStackGeneratorWithDependencies(requiredStackDefinition("php-symfony"), targetDir, dependencies);
}
export async function runSymfonyCreateProject(targetDir: string): Promise<void> { return runSymfonyCreateProjectWithDependencies(targetDir); }

async function looksLikeDrupalProject(
  targetDir: string,
  dependencies: Pick<InitPreparationDependencies, "fileExists" | "readTextFile">
): Promise<boolean> {
  const hasFile = dependencies.fileExists ?? fileExists;
  const readText = dependencies.readTextFile ?? readTextFile;

  if (await hasFile(resolve(targetDir, "web", "index.php"))) {
    return true;
  }

  if (!(await hasFile(resolve(targetDir, "composer.json")))) {
    return false;
  }

  try {
    const composerJson = await readText(resolve(targetDir, "composer.json"));
    return /drupal\/(core|recommended-project|legacy-project)/i.test(composerJson);
  } catch {
    return false;
  }
}

async function looksLikeRailsProject(
  targetDir: string,
  dependencies: Pick<InitPreparationDependencies, "fileExists">
): Promise<boolean> {
  const hasFile = dependencies.fileExists ?? fileExists;
  return (
    (await hasFile(resolve(targetDir, "Gemfile"))) &&
    ((await hasFile(resolve(targetDir, "bin", "rails"))) ||
      (await hasFile(resolve(targetDir, "config", "application.rb"))))
  );
}

async function looksLikeWordPressProject(
  targetDir: string,
  dependencies: Pick<InitPreparationDependencies, "fileExists">
): Promise<boolean> {
  const hasFile = dependencies.fileExists ?? fileExists;
  return (
    (await hasFile(resolve(targetDir, "index.php"))) &&
    ((await hasFile(resolve(targetDir, "wp-config.php"))) ||
      (await hasFile(resolve(targetDir, "wp-content"))) ||
      (await hasFile(resolve(targetDir, "wp-includes", "version.php"))))
  );
}

async function looksLikeSymfonyProject(
  targetDir: string,
  dependencies: Pick<InitPreparationDependencies, "fileExists" | "readTextFile">
): Promise<boolean> {
  const hasFile = dependencies.fileExists ?? fileExists;
  const readText = dependencies.readTextFile ?? readTextFile;

  if ((await hasFile(resolve(targetDir, "bin", "console"))) || (await hasFile(resolve(targetDir, "config", "bundles.php")))) {
    return true;
  }

  if (!(await hasFile(resolve(targetDir, "composer.json")))) {
    return false;
  }

  try {
    const composerJson = await readText(resolve(targetDir, "composer.json"));
    return /symfony\/(framework-bundle|runtime|console|webapp-pack|skeleton)/i.test(composerJson);
  } catch {
    return false;
  }
}

export async function prepareInitTarget(
  definition: StackDefinition,
  targetDir: string,
  blankTemplate: boolean,
  dependencies: InitPreparationDependencies = {}
): Promise<InitPreparationResult> {
  const template = definition.id;
  const hasFiles = dependencies.directoryHasFiles ?? directoryHasFiles;
  const nonEmpty = await hasFiles(targetDir);

  if (template === "php-drupal") {
    if (nonEmpty) {
      if (await looksLikeDrupalProject(targetDir, dependencies)) {
        return {
          overwriteTemplateFiles: true,
          templateEntriesToUpdate: ["devroost.yaml"],
          templateEntriesToCreateIfMissing: [".env.example"]
        };
      }

      throw new Error(
        `Target directory '${targetDir}' must be empty to initialize '${template}' because Devroost runs composer create-project in that directory.`
      );
    }

    const bootstrapDrupal = dependencies.runDrupalCreateProject ?? ((path: string) => runStackGeneratorWithDependencies(definition, path));
    await bootstrapDrupal(targetDir);
    return { overwriteTemplateFiles: false };
  }

  if (template === "php-wordpress") {
    if (nonEmpty) {
      if (await looksLikeWordPressProject(targetDir, dependencies)) {
        return {
          overwriteTemplateFiles: true,
          templateEntriesToUpdate: ["devroost.yaml"],
          templateEntriesToCreateIfMissing: [".env.example", "wp-config.php"]
        };
      }

      throw new Error(
        `Target directory '${targetDir}' must be empty to initialize '${template}' because Devroost bootstraps WordPress files in that directory.`
      );
    }

    const bootstrapWordPress = dependencies.runWordPressCreateProject ?? ((path: string) => runStackGeneratorWithDependencies(definition, path));
    await bootstrapWordPress(targetDir);
    return { overwriteTemplateFiles: false };
  }

  if (template === "rails7") {
    if (nonEmpty) {
      if (await looksLikeRailsProject(targetDir, dependencies)) {
        return {
          overwriteTemplateFiles: true,
          templateEntriesToUpdate: ["devroost.yaml"],
          templateEntriesToCreateIfMissing: [".env.example"]
        };
      }

      throw new Error(
        `Target directory '${targetDir}' must be empty to initialize '${template}' because Devroost bootstraps the Rails project in that directory.`
      );
    }

    const bootstrapRails = dependencies.runRailsCreateProject ?? ((path: string) => runStackGeneratorWithDependencies(definition, path));
    await bootstrapRails(targetDir);
    return { overwriteTemplateFiles: false };
  }

  if (template === "rails7-hotwire") {
    if (nonEmpty) {
      if (await looksLikeRailsProject(targetDir, dependencies)) {
        return {
          overwriteTemplateFiles: true,
          templateEntriesToUpdate: ["devroost.yaml"],
          templateEntriesToCreateIfMissing: [".env.example"]
        };
      }

      throw new Error(
        `Target directory '${targetDir}' must be empty to initialize '${template}' because Devroost bootstraps the Rails project in that directory.`
      );
    }

    const bootstrapRailsHotwire = dependencies.runRailsHotwireCreateProject ?? ((path: string) => runStackGeneratorWithDependencies(definition, path));
    await bootstrapRailsHotwire(targetDir);
    return { overwriteTemplateFiles: false };
  }

  if (template === "php-symfony") {
    if (nonEmpty) {
      if (await looksLikeSymfonyProject(targetDir, dependencies)) {
        return {
          overwriteTemplateFiles: true,
          templateEntriesToUpdate: ["devroost.yaml"],
          templateEntriesToCreateIfMissing: [".env.example"]
        };
      }

      throw new Error(
        `Target directory '${targetDir}' must be empty to initialize '${template}' because Devroost bootstraps the Symfony project in that directory.`
      );
    }

    const bootstrapSymfony = dependencies.runSymfonyCreateProject ?? ((path: string) => runStackGeneratorWithDependencies(definition, path));
    await bootstrapSymfony(targetDir);
    return {
      overwriteTemplateFiles: false,
      templateEntriesToUpdate: ["devroost.yaml"],
      templateEntriesToCreateIfMissing: [".env.example"]
    };
  }

  if (nonEmpty && blankTemplate) {
    process.stderr.write(
      `Warning: '--blank-template' will delete all existing files in '${targetDir}'. Starting fresh template copy...\n`
    );
    const clear = dependencies.clearDirectory ?? clearDirectoryContents;
    await clear(targetDir);
    return { overwriteTemplateFiles: false };
  }

  if (nonEmpty) {
    return {
      overwriteTemplateFiles: false,
      templateEntriesToUpdate: ["devroost.yaml"],
      templateEntriesToCreateIfMissing: [".env.example"]
    };
  }

  return { overwriteTemplateFiles: false };
}
