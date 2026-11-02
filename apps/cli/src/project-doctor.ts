import { constants } from "node:fs";
import { access, lstat, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import type { LoomConfig } from "@loom/config";
import { containerName, detectPodmanCapabilities, listProjectContainers, type PodmanCapabilities } from "@loom/runtime-podman";
import { classifyProjectManifestStack, type LoadedProjectManifest } from "./project-manifest.js";
import { findStackDefinition, type StackDefinition } from "./stacks.js";

export type DoctorStatus = "pass" | "warning" | "failure";
export interface DoctorResult { id: string; status: DoctorStatus; summary: string; detail?: string }
export interface DoctorProbes {
  podman(): Promise<PodmanCapabilities>;
  architecture(): NodeJS.Architecture;
  pathState(path: string): Promise<{ exists: boolean; uid?: number; writable: boolean }>;
  portAvailable(port: number): Promise<boolean>;
  runningContainers(projectName: string): Promise<readonly string[]>;
  hostsWritable(): Promise<boolean>;
}

export interface RunProjectDoctorOptions {
  projectRoot: string;
  config: LoomConfig;
  manifest: LoadedProjectManifest;
  stack?: StackDefinition;
  probes?: DoctorProbes;
}

const lockfileFamilies = [
  { manifest: "package.json", locks: ["bun.lock", "bun.lockb", "npm-shrinkwrap.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"] },
  { manifest: "composer.json", locks: ["composer.lock"] },
  { manifest: "pyproject.toml", locks: ["Pipfile.lock", "poetry.lock", "uv.lock"] },
  { manifest: "Gemfile", locks: ["Gemfile.lock"] },
  { manifest: "pom.xml", locks: ["gradle.lockfile"] }
] as const;
const runtimeImageServiceTypeByEnv: Readonly<Record<string, string>> = {
  ALPINE_IMAGE: "alpine",
  BUN_IMAGE: "node",
  DOTNET_IMAGE: "dotnet",
  ELASTICSEARCH_IMAGE: "elasticsearch",
  JAVA_IMAGE: "java",
  MARIADB_IMAGE: "mariadb",
  MEMCACHED_IMAGE: "memcached",
  MONGO_IMAGE: "mongodb",
  MSSQL_IMAGE: "sqlserver",
  MYSQL_IMAGE: "mysql",
  NODE_IMAGE: "node",
  PHP_IMAGE: "php",
  POSTGRES_IMAGE: "postgres",
  PYTHON_IMAGE: "python",
  REDIS_IMAGE: "redis",
  RUBY_IMAGE: "ruby",
  SQLITE_IMAGE: "sqlite",
  WORDPRESS_IMAGE: "php"
};

function result(id: string, status: DoctorStatus, summary: string, detail?: string): DoctorResult {
  return { id, status, summary, ...(detail ? { detail } : {}) };
}

function dependencyRoots(stack: StackDefinition | undefined): string[] {
  if (!stack) return [];
  return [...new Set(stack.generatedPaths
    .filter(({ category }) => category === "dependency")
    .map(({ path }) => {
      const railsBundleSuffix = "vendor/bundle";
      if (path === railsBundleSuffix) return "";
      if (path.endsWith(`/${railsBundleSuffix}`)) return path.slice(0, -railsBundleSuffix.length - 1);
      const parent = dirname(path);
      return parent === "." ? "" : parent;
    }))].sort();
}

async function dependencyFiles(projectRoot: string, roots: readonly string[]): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  for (const relativeDirectory of roots) {
    const directory = resolve(projectRoot, relativeDirectory);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
    const names = new Set<string>();
    for (const entry of entries) {
      if (entry.isFile()) names.add(entry.name);
    }
    found.set(relativeDirectory, names);
  }
  return found;
}

interface PortMapping { hostPort?: number; containerPort: number; source: string }
function parsePortMapping(mapping: string): PortMapping | undefined {
  const protocolParts = mapping.split("/");
  if (protocolParts.length > 2 || (protocolParts[1] !== undefined && protocolParts[1] !== "tcp")) return undefined;
  const parts = protocolParts[0]!.split(":");
  if (parts.length < 1 || parts.length > 3) return undefined;
  const numbers = parts.length === 3 ? parts.slice(1) : parts;
  if (parts.length === 3 && !parts[0]) return undefined;
  if (!numbers.every((value) => /^\d+$/.test(value))) return undefined;
  const parsed = numbers.map(Number);
  if (parsed.some((port) => port < 1 || port > 65_535)) return undefined;
  return parsed.length === 1
    ? { containerPort: parsed[0]!, source: mapping }
    : { hostPort: parsed[0]!, containerPort: parsed[1]!, source: mapping };
}

async function manifestCheck(options: RunProjectDoctorOptions): Promise<DoctorResult> {
  if (options.manifest.kind === "missing") return result("manifest", "failure", "Project manifest is missing");
  if (!options.stack || options.stack.id !== options.manifest.manifest.stack.id) return result("manifest", "failure", "Manifest selects an unknown stack", options.manifest.manifest.stack.id);
  const compatibility = classifyProjectManifestStack(options.manifest.manifest, options.stack);
  if (compatibility.kind === "incompatible") return result("manifest", "failure", "Project manifest is incompatible with this Devroost release", compatibility.reason);
  if (options.manifest.kind === "migration-required") return result("manifest", "warning", "Project manifest requires migration", "Run devroost upgrade --initialize-baseline.");
  if (compatibility.kind === "legacy-compatible") {
    return result("manifest", "warning", "Project definition metadata requires upgrade", "Run devroost upgrade to record the current definition version.");
  }
  return result("manifest", "pass", "Project manifest is current");
}

function imagesCheck(options: RunProjectDoctorOptions): DoctorResult {
  if (!options.stack) return result("images", "failure", "Runtime image pins cannot be checked for an unknown stack");
  const expectedByServiceType = new Map<string, Set<string>>();
  const addDefinitionImages = (definition: StackDefinition): void => {
    for (const { env, reference } of definition.runtimeImages) {
      const serviceType = runtimeImageServiceTypeByEnv[env];
      if (!serviceType) continue;
      const references = expectedByServiceType.get(serviceType) ?? new Set<string>();
      references.add(reference);
      expectedByServiceType.set(serviceType, references);
    }
  };
  addDefinitionImages(options.stack);
  if (options.manifest.kind === "ready") {
    for (const database of [...new Set(options.manifest.manifest.renderInputs.databases)].sort()) {
      const definition = findStackDefinition(`db-${database}`);
      if (definition) addDefinitionImages(definition);
    }
  }
  const overrides = Object.entries(options.config.services)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, service]) => expectedByServiceType.get(service.type)?.has(service.image) !== true)
    .map(([serviceName, service]) => `${serviceName}=${service.image}`);
  return overrides.length
    ? result("images", "warning", "Runtime image overrides reduce reproducibility", overrides.join("; "))
    : result("images", "pass", "Runtime images match selected stack definitions");
}

async function podmanCheck(config: LoomConfig, probes: DoctorProbes): Promise<DoctorResult> {
  if (!config.runtime.rootless) return result("podman", "failure", "Project configuration does not enable rootless Podman");
  const capabilities = await probes.podman();
  if (!capabilities.available) return result("podman", "failure", "Podman is unavailable");
  if (!capabilities.rootless) return result("podman", "failure", "Podman is not running rootless");
  return result("podman", "pass", "Rootless Podman is available", capabilities.version);
}

function architectureCheck(stack: StackDefinition | undefined, probes: DoctorProbes): DoctorResult {
  const architecture = probes.architecture();
  if (!stack) return result("architecture", "failure", "Stack compatibility is unknown");
  return stack.compatibility.architectures.includes(architecture)
    ? result("architecture", "pass", `Host architecture ${architecture} is supported`)
    : result("architecture", "failure", `Host architecture ${architecture} is unsupported`);
}

async function lockfilesCheck(projectRoot: string, stack: StackDefinition | undefined): Promise<DoctorResult> {
  const directories = await dependencyFiles(projectRoot, dependencyRoots(stack));
  const problems: string[] = [];
  for (const [directory, names] of [...directories].sort(([a], [b]) => a.localeCompare(b))) {
    for (const family of lockfileFamilies) {
      if (!names.has(family.manifest)) continue;
      const present = family.locks.filter((lock) => names.has(lock));
      const location = directory || ".";
      if (present.length === 0) problems.push(`${location}/${family.manifest}: missing lockfile`);
      else if (present.length > 1) problems.push(`${location}/${family.manifest}: conflicting lockfiles (${present.join(", ")})`);
    }
  }
  if (!problems.length) return result("lockfiles", "pass", "Dependency lockfiles are consistent");
  const conflicts = problems.filter((problem) => problem.includes("conflicting"));
  return result("lockfiles", conflicts.length ? "failure" : "warning", conflicts.length ? "Dependency lockfiles conflict" : "Dependency lockfiles are missing", problems.join("; "));
}

async function dependenciesCheck(projectRoot: string, stack: StackDefinition | undefined, probes: DoctorProbes): Promise<DoctorResult> {
  if (!stack) return result("dependencies", "failure", "Dependency paths cannot be checked for an unknown stack");
  const failures: string[] = [];
  const currentUid = process.getuid?.();
  for (const item of stack.generatedPaths.filter(({ category }) => category === "dependency")) {
    const state = await probes.pathState(resolve(projectRoot, item.path));
    if (!state.exists) continue;
    if (!state.writable) failures.push(`${item.path} is not writable`);
    if (currentUid !== undefined && state.uid !== undefined && state.uid !== currentUid) failures.push(`${item.path} is owned by uid ${state.uid}`);
  }
  return failures.length
    ? result("dependencies", "failure", "Dependency paths have ownership or permission problems", failures.join("; "))
    : result("dependencies", "pass", "Dependency paths are writable");
}

function parsedServicePorts(config: LoomConfig): { mappings: Map<string, PortMapping[]>; errors: string[] } {
  const mappings = new Map<string, PortMapping[]>();
  const errors: string[] = [];
  for (const [serviceName, service] of Object.entries(config.services).sort(([a], [b]) => a.localeCompare(b))) {
    const parsed: PortMapping[] = [];
    for (const mapping of service.ports ?? []) {
      const value = parsePortMapping(mapping);
      if (value) parsed.push(value); else errors.push(`${serviceName}: ${mapping}`);
    }
    mappings.set(serviceName, parsed);
  }
  return { mappings, errors };
}

async function portsCheck(config: LoomConfig, probes: DoctorProbes, parsed: ReturnType<typeof parsedServicePorts>): Promise<DoctorResult> {
  if (parsed.errors.length) return result("ports", "failure", "Service port mappings are invalid", parsed.errors.join("; "));
  const claims = new Map<number, string[]>();
  for (const [serviceName, mappings] of parsed.mappings) {
    for (const mapping of mappings) {
      if (mapping.hostPort === undefined) continue;
      const existing = claims.get(mapping.hostPort) ?? [];
      existing.push(`${serviceName} (${mapping.source})`);
      claims.set(mapping.hostPort, existing);
    }
  }
  const duplicateClaims = [...claims].filter(([, claimants]) => claimants.length > 1).sort(([a], [b]) => a - b);
  if (duplicateClaims.length) {
    return result("ports", "failure", "Configured host ports have conflicting claims",
      duplicateClaims.map(([port, claimants]) => `${port}: ${claimants.join(", ")}`).join("; "));
  }
  const ports = [...new Set([...parsed.mappings.values()].flatMap((items) => items.flatMap(({ hostPort }) => hostPort === undefined ? [] : [hostPort])))].sort((a, b) => a - b);
  const runningContainers = new Set(await probes.runningContainers(config.name));
  const unavailable: number[] = [];
  for (const port of ports) {
    if (await probes.portAvailable(port)) continue;
    const belongsToRunningService = [...parsed.mappings].some(([serviceName, mappings]) =>
      mappings.some(({ hostPort }) => hostPort === port) && runningContainers.has(containerName(config.name, serviceName)));
    if (!belongsToRunningService) unavailable.push(port);
  }
  return unavailable.length ? result("ports", "failure", "Configured host ports are unavailable", unavailable.join(", ")) : result("ports", "pass", "Configured host ports are available");
}

function routesCheck(config: LoomConfig, parsed: ReturnType<typeof parsedServicePorts>): DoctorResult {
  const failures: string[] = [];
  for (const route of config.routes ?? []) {
    const servicePorts = parsed.mappings.get(route.service);
    if (!servicePorts) failures.push(`${route.host}: service ${route.service} does not exist`);
    else if (!servicePorts.some(({ containerPort }) => containerPort === route.port)) failures.push(`${route.host}: ${route.service} does not expose container port ${route.port}`);
  }
  return failures.length ? result("routes", "failure", "Routes have invalid targets", failures.join("; ")) : result("routes", "pass", "Routes target exposed service ports");
}

async function hostsCheck(config: LoomConfig, probes: DoctorProbes): Promise<DoctorResult> {
  if (!(config.routes?.length)) return result("hosts", "pass", "No route host integration is required");
  return await probes.hostsWritable()
    ? result("hosts", "pass", "Route host integration is writable")
    : result("hosts", "warning", "Route host integration is unavailable", "Localhost access remains available.");
}

async function defaultPathState(path: string): Promise<{ exists: boolean; uid?: number; writable: boolean }> {
  try {
    const state = await lstat(path);
    try { await access(path, constants.W_OK); return { exists: true, uid: state.uid, writable: true }; }
    catch { return { exists: true, uid: state.uid, writable: false }; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, writable: false };
    throw error;
  }
}

async function defaultPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolveResult, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) =>
      error.code === "EADDRINUSE" || error.code === "EACCES" || error.code === "EPERM"
        ? resolveResult(false)
        : reject(error));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close((error) => error ? reject(error) : resolveResult(true)));
  });
}

export function defaultDoctorProbes(): DoctorProbes {
  return {
    podman: detectPodmanCapabilities,
    architecture: () => process.arch,
    pathState: defaultPathState,
    portAvailable: defaultPortAvailable,
    runningContainers: async (projectName) => {
      try {
        return (await listProjectContainers(projectName)).filter(({ running }) => running).map(({ name }) => name);
      } catch {
        // Podman availability is reported by the dedicated check; absence must not
        // prevent the remaining diagnostics or JSON output from being rendered.
        return [];
      }
    },
    hostsWritable: async () => {
      if (process.platform === "win32") return false;
      try { await access("/etc/hosts", constants.W_OK); return true; } catch { return false; }
    }
  };
}

export async function runProjectDoctor(options: RunProjectDoctorOptions): Promise<DoctorResult[]> {
  const probes = options.probes ?? defaultDoctorProbes();
  const parsed = parsedServicePorts(options.config);
  return [
    await manifestCheck(options),
    imagesCheck(options),
    await podmanCheck(options.config, probes),
    architectureCheck(options.stack, probes),
    await lockfilesCheck(options.projectRoot, options.stack),
    await dependenciesCheck(options.projectRoot, options.stack, probes),
    await portsCheck(options.config, probes, parsed),
    routesCheck(options.config, parsed),
    await hostsCheck(options.config, probes)
  ];
}
