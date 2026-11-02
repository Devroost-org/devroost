import { isAbsolute, posix } from "node:path";

export const stackIds = [
  "node", "node-mean", "node-mern", "node-t3", "bun", "python", "python-django", "python-flask",
  "python-fastapi", "php", "php-wordpress", "php-drupal", "php-symfony", "db-mysql", "db-sqlserver",
  "db-postgres", "db-mongodb", "db-redis", "db-elasticsearch", "db-sqlite", "db-mariadb", "db-all",
  "dotnet", "rails7", "rails7-hotwire", "jamstack", "serverless", "spring-react", "spring-boot", "astro",
  "django-react"
] as const;

export type StackId = typeof stackIds[number];
export type GeneratedPathCategory = "dependency" | "cache" | "build";
export interface StackGeneratedPath { path: string; category: GeneratedPathCategory }
export interface StackCompatibility {
  architectures: readonly NodeJS.Architecture[];
  runtime: "podman-rootless";
}
export interface StackGeneratorExecution {
  kind: "container";
  context: string;
  mountTarget: string;
  workdir?: string;
  environment: readonly { name: string; value: string }[];
}
export type StackGenerator =
  | { kind: "none" }
  | {
      kind: "command";
      image: string;
      package: string;
      version: string;
      command: readonly string[];
      execution: StackGeneratorExecution;
    };
export interface StackRuntimeImage { env: string; reference: string }
export interface StackVerificationCheck { service?: string; command: readonly string[] }
export interface StackDocumentedService { name: string; purpose: string }
export interface StackDocumentedEndpoint { label: string; value: string }
export interface StackDocumentation {
  summary: string;
  useCase: string;
  initCommand: string;
  supportsOptionalDatabases: boolean;
  services: readonly StackDocumentedService[];
  endpoints: readonly StackDocumentedEndpoint[];
  notes: readonly string[];
}
export interface StackDefinition {
  id: StackId;
  definitionVersion: number;
  legacyScaffoldVersions: readonly string[];
  assetPath: string;
  /** Compatibility field consumed by v1/v2 project manifests. */
  scaffoldVersion: string;
  generator: StackGenerator;
  runtimeImages: readonly StackRuntimeImage[];
  install: readonly string[];
  start: readonly string[];
  readiness: { kind: "command" | "http" | "port"; value: string; timeoutSeconds: number };
  hostWrites: readonly string[];
  verification: readonly StackVerificationCheck[];
  devroostOwnedFiles: readonly string[];
  generatedPaths: readonly StackGeneratedPath[];
  protectedPaths: readonly string[];
  compatibility: StackCompatibility;
  documentation?: StackDocumentation;
}
export type DocumentedStackDefinition = StackDefinition & { documentation: StackDocumentation };

function safeRelative(path: string): boolean {
  if (!path || path === "." || isAbsolute(path) || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..") && posix.normalize(path) === path;
}

function assertSortedUnique(values: readonly string[], kind: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${kind}`);
  if (values.some((value, index) => index > 0 && values[index - 1]! > value)) {
    throw new Error(`${kind} must be sorted`);
  }
}

export function validateGeneratorVersion(version: string): void {
  const rejected = /^(?:latest|next|canary|nightly|unversioned)$/i;
  if (!version || rejected.test(version) || /[\s*^~<>=|]/.test(version) || /(?:^|\.)x(?:\.|$)/i.test(version) || !/^\d+(?:\.\d+){1,}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Expected exact generator version, received '${version}'`);
  }
}

export function validateRuntimeImage(image: StackRuntimeImage): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(image.env)) throw new Error(`Runtime image environment '${image.env}' must be uppercase`);
  const withoutDigest = image.reference.split("@", 1)[0]!;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const colon = withoutDigest.lastIndexOf(":");
  const tag = colon > lastSlash ? withoutDigest.slice(colon + 1) : "";
  const digest = image.reference.includes("@") ? image.reference.slice(image.reference.indexOf("@") + 1) : undefined;
  const exactTag = /^(?:\d+\.\d+\.\d+(?:[-.][0-9A-Za-z][0-9A-Za-z.-]*)?|\d+\.\d+-[A-Za-z][0-9A-Za-z.-]*)$/.test(tag)
    || /^\d{4}(?:[-.]\d{2}){1,2}(?:[-.][0-9A-Za-z.-]+)?$/.test(tag)
    || /(?:^|-)CU\d+(?:-|$)/i.test(tag);
  const exactDigest = digest !== undefined && /^sha256:[a-f0-9]{64}$/.test(digest);
  if ((digest === undefined && (!tag || tag.toLowerCase() === "latest" || !exactTag)) || (digest !== undefined && !exactDigest)) {
    throw new Error(`Runtime image '${image.reference}' must use an exact version tag or immutable digest`);
  }
}

export function validateStackDocumentation(id: StackId, documentation: StackDocumentation): void {
  if (!documentation.summary.trim() || !documentation.useCase.trim()) {
    throw new Error(`${id} documentation requires a summary and use case`);
  }
  if (!documentation.initCommand.startsWith(`devroost init ${id} `)) {
    throw new Error(`${id} documentation init command must start with 'devroost init ${id}'`);
  }
  if (id.startsWith("db-") && documentation.supportsOptionalDatabases) {
    throw new Error(`${id} database stack cannot support optional databases`);
  }
  if (documentation.services.length === 0) throw new Error(`${id} documentation requires services`);
  const serviceNames = documentation.services.map(({ name }) => name);
  if (new Set(serviceNames).size !== serviceNames.length || serviceNames.some((name) => !/^[a-z][a-z0-9-]*$/.test(name))) {
    throw new Error(`${id} documentation requires unique valid service names`);
  }
  if (documentation.services.some(({ purpose }) => !purpose.trim())) throw new Error(`${id} documentation requires service purposes`);
  if (documentation.endpoints.some(({ label, value }) => !label.trim() || !value.trim())) {
    throw new Error(`${id} documentation requires complete endpoints`);
  }
  if (documentation.notes.some((note) => !note.trim())) throw new Error(`${id} documentation contains an empty note`);
}

export function validateStackDefinition(definition: StackDefinition): void {
  if (!stackIds.includes(definition.id)) throw new Error(`Unknown stack id: ${definition.id}`);
  if (!Number.isInteger(definition.definitionVersion) || definition.definitionVersion <= 0) throw new Error("Definition version must be a positive integer");
  if (definition.assetPath !== `${definition.id}/templates` || !safeRelative(definition.assetPath)) throw new Error(`Unsafe asset path: ${definition.assetPath}`);
  assertSortedUnique(definition.legacyScaffoldVersions, "legacy scaffold versions");
  if (definition.generator.kind === "command") {
    if (!definition.generator.package.trim() || definition.generator.command.length === 0 || definition.generator.command.some((argument) => !argument.trim())) {
      throw new Error("Command generator requires a package and nonempty command argv");
    }
    validateRuntimeImage({ env: "GENERATOR_IMAGE", reference: definition.generator.image });
    validateGeneratorVersion(definition.generator.version);
    const execution = definition.generator.execution;
    const containerPaths = [execution.mountTarget, ...(execution.workdir === undefined ? [] : [execution.workdir])];
    if (execution.kind !== "container" || !execution.context.trim() || containerPaths.some((path) =>
      !path.startsWith("/") || path.includes("\\") || path.split("/").some((part, index) => index > 0 && (!part || part === "." || part === "..")))) {
      throw new Error("Command generator requires valid container execution topology");
    }
    const environmentNames = execution.environment.map(({ name }) => name);
    assertSortedUnique(environmentNames, "generator execution environment names");
    if (execution.environment.some(({ name, value }) => !/^[A-Z][A-Z0-9_]*$/.test(name) || !value.trim())) {
      throw new Error("Command generator requires valid execution environment values");
    }
  }
  const runtimeEnvs = definition.runtimeImages.map(({ env }) => env);
  assertSortedUnique(runtimeEnvs, "runtime image environments");
  for (const image of definition.runtimeImages) validateRuntimeImage(image);
  for (const check of definition.verification) {
    if (check.service !== undefined && !/^[a-z][a-z0-9-]*$/.test(check.service)) {
      throw new Error(`Verification service '${check.service}' must be a service name`);
    }
    if (check.command.length === 0 || check.command.some((argument) => !argument.trim())) {
      throw new Error("Verification command requires nonempty argv");
    }
  }

  const generatedPaths = definition.generatedPaths.map(({ path }) => path);
  const protectedPaths = [...definition.protectedPaths];
  for (const [kind, paths] of [["generated path", generatedPaths], ["protected path", protectedPaths], ["Devroost-owned path", definition.devroostOwnedFiles], ["host-write path", definition.hostWrites]] as const) {
    for (const path of paths) if (!safeRelative(path) || path === ".devroost" || path.startsWith(".devroost/")) throw new Error(`Unsafe ${kind}: ${path}`);
    assertSortedUnique(paths, `${kind}s`);
  }
  for (const generatedPath of generatedPaths) {
    if (protectedPaths.some((path) => generatedPath === path || path.startsWith(`${generatedPath}/`))) throw new Error(`Generated path contains protected path: ${generatedPath}`);
  }
  if (!Number.isInteger(definition.readiness.timeoutSeconds) || definition.readiness.timeoutSeconds <= 0 || !definition.readiness.value.trim()) throw new Error("Readiness requires a value and positive timeout");
  assertSortedUnique(definition.compatibility.architectures, "architectures");
  if (definition.documentation) validateStackDocumentation(definition.id, definition.documentation);
}

export function defineStack<const T extends StackDefinition>(definition: T): T {
  validateStackDefinition(definition);
  return definition;
}
