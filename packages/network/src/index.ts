import type { LoomConfig } from "@loom/config";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { CertificatePaths } from "@loom/https";
import { ensurePodmanNetwork, runPodman } from "@loom/runtime-podman";

export interface RouteBinding {
  host: string;
  service: string;
  targetPort: number;
  externalPort: number;
  https: boolean;
}

export interface ProxyRuntime {
  containerName: string;
  httpPort: number;
  httpsPort: number;
}

export interface RouteHostManagementResult {
  managedHosts: string[];
  skippedHosts: string[];
  pendingHosts?: string[];
}

export function projectNetworkName(projectName: string): string {
  return `loom-${projectName}`;
}

function windowsHostsFilePath(): string {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return process.env.LOOM_WINDOWS_HOSTS_FILE ?? resolve(systemRoot, "System32", "drivers", "etc", "hosts");
}

function managedHostsStartMarker(projectName: string): string {
  return `# >>> loom:${projectName}`;
}

function managedHostsEndMarker(projectName: string): string {
  return `# <<< loom:${projectName}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeManagedHostsBlock(content: string, projectName: string): string {
  const start = escapeRegExp(managedHostsStartMarker(projectName));
  const end = escapeRegExp(managedHostsEndMarker(projectName));
  const blockPattern = new RegExp(`(?:^|\\n)${start}\\n[\\s\\S]*?\\n${end}(?=\\n|$)`, "g");
  return content.replace(blockPattern, "").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
}

function renderManagedHostsBlock(projectName: string, hosts: string[]): string {
  return [
    managedHostsStartMarker(projectName),
    ...hosts.map((host) => `127.0.0.1 ${host}`),
    managedHostsEndMarker(projectName)
  ].join("\n");
}

export function applyManagedHostsEntries(content: string, projectName: string, hosts: string[]): string {
  const withoutExistingBlock = removeManagedHostsBlock(content, projectName).trimEnd();
  if (hosts.length === 0) {
    return withoutExistingBlock ? `${withoutExistingBlock}\n` : "";
  }

  const nextBlock = renderManagedHostsBlock(projectName, hosts);
  return withoutExistingBlock ? `${withoutExistingBlock}\n\n${nextBlock}\n` : `${nextBlock}\n`;
}

function uniqueRouteHosts(bindings: RouteBinding[]): RouteHostManagementResult {
  const managedHosts = [...new Set(bindings.map((binding) => binding.host).filter((host) => !host.startsWith("*.")))].sort();
  const skippedHosts = [...new Set(bindings.map((binding) => binding.host).filter((host) => host.startsWith("*.")))].sort();
  return { managedHosts, skippedHosts };
}

function assertSafeRouteHost(host: string): void {
  const valid = /^(?:\*\.)?(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/.test(host);
  if (!valid) {
    throw new Error(`Route host '${host}' is invalid.`);
  }
}

function assertSafeServiceName(serviceName: string): void {
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(serviceName);
  if (!valid) {
    throw new Error(`Service name '${serviceName}' is invalid for routing.`);
  }
}

function parsePublishedPort(portMapping: string): { host: number; container: number } | null {
  const withoutProtocol = portMapping.split("/")[0]?.trim();
  if (!withoutProtocol) {
    return null;
  }

  const segments = withoutProtocol.split(":").map((segment) => segment.trim());
  if (segments.length < 2) {
    return null;
  }

  const host = Number(segments[segments.length - 2]);
  const container = Number(segments[segments.length - 1]);
  if (!Number.isFinite(host) || !Number.isFinite(container) || host <= 0 || container <= 0) {
    return null;
  }

  return { host, container };
}

export function resolveRouteBindings(config: LoomConfig): RouteBinding[] {
  return (config.routes ?? []).map((route) => {
    assertSafeRouteHost(route.host);
    assertSafeServiceName(route.service);

    const service = config.services[route.service];
    if (!service) {
      throw new Error(`Route references unknown service '${route.service}'.`);
    }

    const mappedPort = (service.ports ?? [])
      .map((port) => parsePublishedPort(port))
      .find((mapping) => mapping?.container === route.port);

    const externalPort = mappedPort ? mappedPort.host : route.port;

    return {
      host: route.host,
      service: route.service,
      targetPort: route.port,
      externalPort,
      https: route.https ?? true
    };
  });
}

export async function ensureServiceNetwork(config: LoomConfig): Promise<string> {
  const network = projectNetworkName(config.name);
  await ensurePodmanNetwork(network);
  return network;
}

const SHARED_PROXY = "loom-proxy";
const PROXY_SITES_DIR = "/etc/caddy/sites";

function buildProjectCaddyfile(projectName: string, bindings: RouteBinding[], certPath: string, keyPath: string): string {
  return bindings.map((binding) => {
    const scheme = binding.https ? "https" : "http";
    const tlsConfig = binding.https ? `\n  tls ${certPath} ${keyPath}` : "";
    return `${scheme}://${binding.host} {\n  reverse_proxy ${projectName}-${binding.service}:${binding.targetPort}${tlsConfig}\n}`;
  }).join("\n\n");
}

function buildMainCaddyfile(): string {
  return `{
  auto_https off
}
import ${PROXY_SITES_DIR}/*.Caddyfile
`;
}

async function writeSharedProxyConfig(
  projectName: string,
  bindings: RouteBinding[],
  certPath: string,
  keyPath: string,
  networkDir: string
): Promise<void> {
  await mkdir(networkDir, { recursive: true });

  const projectFile = resolve(networkDir, `${projectName}.Caddyfile`);
  const mainFile = resolve(networkDir, "Caddyfile");

  if (bindings.length > 0) {
    await writeFile(projectFile, buildProjectCaddyfile(projectName, bindings, certPath, keyPath), "utf-8");
  } else {
    try { await rm(projectFile, { force: true }); } catch { /* ignore */ }
  }

  await writeFile(mainFile, buildMainCaddyfile(), "utf-8");
}

export interface ProxyDependencies {
  stateDir?: string;
  runPodmanCommand?: typeof runPodman;
}

function proxyStateDir(dependencies: ProxyDependencies): string {
  return dependencies.stateDir ?? resolve(homedir(), ".loom", "network");
}

async function reloadProxy(run: typeof runPodman): Promise<void> {
  const reload = await run([
    "exec", SHARED_PROXY, "caddy", "reload", "--config",
    "/etc/caddy/sites/Caddyfile", "--adapter", "caddyfile"
  ]);
  if (!reload.ok) throw new Error(`Failed to reload route proxy: ${reload.stderr || "unknown error"}`);
}

export async function ensureRouteProxy(
  config: LoomConfig,
  bindings: RouteBinding[],
  certPaths: CertificatePaths,
  networkName: string,
  hostHttpPort = 8080,
  hostHttpsPort = 8443,
  dependencies: ProxyDependencies = {}
): Promise<ProxyRuntime> {
  const run = dependencies.runPodmanCommand ?? runPodman;
  const runDir = proxyStateDir(dependencies);
  const certDir = resolve(runDir, "certs");
  await mkdir(certDir, { recursive: true, mode: 0o700 });
  const certPath = resolve(certDir, `${config.name}.crt`);
  const keyPath = resolve(certDir, `${config.name}.key`);
  await copyFile(certPaths.certPath, certPath);
  await copyFile(certPaths.keyPath, keyPath);
  await chmod(keyPath, 0o600);
  await writeSharedProxyConfig(config.name, bindings, `/certs/${config.name}.crt`, `/certs/${config.name}.key`, runDir);

  let exists = (await run(["container", "exists", SHARED_PROXY])).ok;
  if (exists) {
    const version = await run(["inspect", "--format", '{{ index .Config.Labels "loom.proxy-version" }}', SHARED_PROXY]);
    if (!version.ok) throw new Error(`Failed to inspect route proxy: ${version.stderr}`);
    // Replace the old project-local mount layout once. Its files cannot serve other projects.
    if (version.stdout.trim() !== "2") {
      const remove = await run(["rm", "-f", SHARED_PROXY]);
      if (!remove.ok) throw new Error(`Failed to migrate route proxy: ${remove.stderr}`);
      exists = false;
    }
  }

  if (!exists) {
    const start = await run([
      "run", "-d", "--name", SHARED_PROXY, "--label", "loom.proxy-version=2",
      "--network", networkName,
      "-p", `${hostHttpPort}:80`, "-p", `${hostHttpsPort}:443`,
      "-v", `${runDir}:/etc/caddy/sites:ro`, "-v", `${certDir}:/certs:ro`,
      "docker.io/library/caddy:2-alpine", "caddy", "run",
      "--config", "/etc/caddy/sites/Caddyfile", "--adapter", "caddyfile"
    ]);
    if (!start.ok) throw new Error(`Failed to start route proxy container '${SHARED_PROXY}': ${start.stderr || "unknown error"}`);
  } else {
    const networks = await run(["inspect", "--format", "{{json .NetworkSettings.Networks}}", SHARED_PROXY]);
    if (!networks.ok) throw new Error(`Failed to inspect proxy networks: ${networks.stderr}`);
    const connected = JSON.parse(networks.stdout) as Record<string, unknown>;
    if (!(networkName in connected)) {
      const connect = await run(["network", "connect", networkName, SHARED_PROXY]);
      if (!connect.ok) throw new Error(`Failed to connect route proxy: ${connect.stderr}`);
    }
    const running = await run(["inspect", "--format", "{{.State.Running}}", SHARED_PROXY]);
    if (!running.ok) throw new Error(`Failed to inspect proxy state: ${running.stderr}`);
    if (running.stdout.trim() !== "true") {
      const start = await run(["start", SHARED_PROXY]);
      if (!start.ok) throw new Error(`Failed to restart route proxy: ${start.stderr}`);
    } else {
      await reloadProxy(run);
    }
  }

  return { containerName: SHARED_PROXY, httpPort: hostHttpPort, httpsPort: hostHttpsPort };
}

export async function ensureRouteHosts(projectName: string, bindings: RouteBinding[]): Promise<RouteHostManagementResult> {
  const result = uniqueRouteHosts(bindings);
  const hostsPath = process.platform === "win32" ? windowsHostsFilePath() : "/etc/hosts";

  try {
    const currentContent = await readFile(hostsPath, "utf-8");
    const nextContent = applyManagedHostsEntries(currentContent, projectName, result.managedHosts);
    if (nextContent !== currentContent) {
      await writeFile(hostsPath, nextContent, "utf-8");
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Warning: Failed to write hosts file (${message})\n`);
    return { managedHosts: [], skippedHosts: result.skippedHosts, pendingHosts: result.managedHosts };
  }
}

export async function stopRouteProxy(projectName: string, dependencies: ProxyDependencies = {}): Promise<void> {
  const runDir = proxyStateDir(dependencies);
  const projectFile = resolve(runDir, `${projectName}.Caddyfile`);
  try {
    await rm(projectFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const run = dependencies.runPodmanCommand ?? runPodman;
  const running = await run(["inspect", "--format", "{{.State.Running}}", SHARED_PROXY]);
  if (running.ok && running.stdout.trim() === "true") await reloadProxy(run);
  await rm(resolve(runDir, "certs", `${projectName}.crt`), { force: true });
  await rm(resolve(runDir, "certs", `${projectName}.key`), { force: true });
}

export async function stopRouteHosts(projectName: string): Promise<void> {
  const hostsPath = process.platform === "win32" ? windowsHostsFilePath() : "/etc/hosts";

  try {
    const currentContent = await readFile(hostsPath, "utf-8");
    const nextContent = removeManagedHostsBlock(currentContent, projectName);
    if (nextContent !== currentContent) {
      await writeFile(hostsPath, nextContent, "utf-8");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Warning: Failed to clean hosts file (${message})\n`);
  }
}
