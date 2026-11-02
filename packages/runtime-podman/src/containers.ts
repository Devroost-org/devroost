import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir, userInfo } from "node:os";
import type { LoomService } from "@loom/config";
import { runPodman } from "./podman.js";

const execFileAsync = promisify(execFile);
import type { ContainerSummary } from "./types.js";

export function normalizeImage(image: string): string {
  if (image.includes("/")) {
    if (image.startsWith("docker.io/") && !image.startsWith("docker.io/library/")) {
      const rest = image.slice("docker.io/".length);
      return rest.includes("/") ? image : `docker.io/library/${rest}`;
    }
    return image;
  }
  return `docker.io/library/${image}`;
}

export function containerName(projectName: string, serviceName: string): string {
  const name = `${projectName}-${serviceName}`;
  // The project length disambiguates hyphens belonging to either identifier.
  return projectName.includes("-") || serviceName.includes("-") ? `${name}--p${projectName.length}` : name;
}

export function ipv4ForwardingError(platform: NodeJS.Platform, value: string): string | null {
  if (platform !== "linux" || value.trim() !== "0") {
    return null;
  }

  return [
    "IPv4 forwarding is disabled, so Devroost's Podman bridge networks cannot access the internet.",
    "Enable it for the current session with: sudo sysctl -w net.ipv4.ip_forward=1",
    "To keep it enabled after reboot, add net.ipv4.ip_forward=1 to /etc/sysctl.d/99-podman-forwarding.conf and run: sudo sysctl --system"
  ].join("\n");
}

async function assertIpv4Forwarding(): Promise<void> {
  if (process.platform !== "linux") {
    return;
  }

  try {
    const value = await readFile("/proc/sys/net/ipv4/ip_forward", "utf8");
    const message = ipv4ForwardingError(process.platform, value);
    if (message) {
      throw new Error(message);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("IPv4 forwarding is disabled")) {
      throw error;
    }
    // Some constrained Linux environments do not expose this procfs setting.
    // In that case, let Podman report the underlying network error.
  }
}

async function isDnsWorking(networkName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("podman", [
      "run", "--rm", "--network", networkName,
      "docker.io/library/alpine:latest",
      "nslookup", "google.com"
    ], { timeout: 15_000 });
    return /Non-authoritative answer/.test(stdout);
  } catch {
    return false;
  }
}

async function restartAardvarkDns(): Promise<void> {
  process.stderr.write("Devroost: aardvark-dns is not responding, restarting it...\n");

  if (process.platform === "linux") {
    try {
      await execFileAsync("pkill", ["-9", "aardvark-dns"], { timeout: 5_000 });
    } catch { /* not running or not found */ }

    const uid = userInfo().uid;
    const configDir = join(tmpdir(), `containers-user-${uid}`, "containers", "networks", "aardvark-dns");
    try {
      await rm(configDir, { recursive: true, force: true });
    } catch { /* may not exist */ }

    await new Promise((r) => setTimeout(r, 3000));
  } else {
    // macOS / Windows: restart the Podman Machine VM
    try {
      await execFileAsync("podman", ["machine", "stop"], { timeout: 30_000 });
      await execFileAsync("podman", ["machine", "start"], { timeout: 60_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Devroost: could not restart Podman Machine: ${msg}\n`);
    }
  }
}

export async function ensurePodmanNetwork(networkName: string): Promise<void> {
  await assertIpv4Forwarding();

  const exists = await runPodman(["network", "exists", networkName]);
  if (!exists.ok) {
    const create = await runPodman(["network", "create", networkName]);
    if (!create.ok) {
      throw new Error(`Failed to create network '${networkName}': ${create.stderr || "unknown error"}`);
    }
  }

  if (!(await isDnsWorking(networkName))) {
    await restartAardvarkDns();
    if (!(await isDnsWorking(networkName))) {
      process.stderr.write(`Devroost: DNS is still not working on network '${networkName}'. ` +
        `Try: podman system reset --force\n`);
    }
  }
}

export async function isContainerRunning(name: string): Promise<boolean> {
  const inspect = await runPodman(["inspect", "--format", "{{.State.Running}}", name]);
  return inspect.ok && inspect.stdout.toLowerCase() === "true";
}

export async function inspectContainer(name: string): Promise<ContainerSummary | null> {
  const inspect = await runPodman([
    "inspect",
    "--format",
    "{{.Name}}|{{.State.Status}}|{{.State.Running}}|{{if .State.Healthcheck}}{{.State.Healthcheck.Status}}{{end}}|{{.ImageName}}",
    name
  ]);

  if (!inspect.ok) {
    return null;
  }

  const [containerNameRaw, state, runningRaw, healthRaw, image] = inspect.stdout.split("|");

  return {
    name: containerNameRaw.replace(/^\//, ""),
    state,
    running: runningRaw.toLowerCase() === "true",
    health: healthRaw || undefined,
    image
  };
}

export async function listProjectContainers(
  projectName: string,
  dependencies: { runPodmanCommand?: typeof runPodman; inspectContainerByName?: typeof inspectContainer } = {}
): Promise<ContainerSummary[]> {
  const list = await (dependencies.runPodmanCommand ?? runPodman)([
    "ps",
    "-a",
    "--filter",
    `label=devroost.project=${projectName}`,
    "--format",
    "{{.Names}}"
  ]);

  if (!list.ok || !list.stdout) {
    return [];
  }

  const names = list.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const inspected = await Promise.all(names.map((name) => (dependencies.inspectContainerByName ?? inspectContainer)(name)));
  return inspected.filter((entry): entry is ContainerSummary => entry !== null);
}

export function parseHostPorts(portMappings: string[] = []): number[] {
  return portMappings
    .map((mapping) => {
      const parts = mapping.split(":").map((part) => part.trim());
      if (parts.length < 2) {
        return Number.NaN;
      }

      const hostPart = parts[parts.length - 2];
      return Number(hostPart);
    })
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseVolumeSource(volume: string): string | null {
  const source = volume.split(":")[0]?.trim();
  if (!source) {
    return null;
  }

  return source;
}

function isBindMountSource(source: string): boolean {
  return source.startsWith(".") || source.startsWith("/") || source.includes("/");
}

export async function ensureBindMountParentDirs(volumes: string[] = []): Promise<void> {
  for (const volume of volumes) {
    const source = parseVolumeSource(volume);
    if (!source || !isBindMountSource(source)) {
      continue;
    }

    const absoluteSource = source.startsWith("/") ? source : resolve(process.cwd(), source);
    await mkdir(absoluteSource, { recursive: true });
  }
}

export async function containerExists(name: string): Promise<boolean> {
  const exists = await runPodman(["container", "exists", name]);
  return exists.ok;
}

export async function inspectContainerImage(name: string): Promise<string> {
  const imageInspect = await runPodman(["inspect", "--format", "{{.ImageName}}", name]);
  return imageInspect.ok ? imageInspect.stdout.trim() : "";
}

export async function inspectContainerLabel(name: string, label: string): Promise<string> {
  const labelInspect = await runPodman([
    "inspect",
    "--format",
    `{{ index .Config.Labels "${label}" }}`,
    name
  ]);

  return labelInspect.ok ? labelInspect.stdout.trim() : "";
}

export function serviceConfigHash(service: LoomService): string {
  const signature = {
    type: service.type,
    image: normalizeImage(service.image),
    user: service.user ?? null,
    userns: service.userns ?? null,
    entrypoint: service.entrypoint ?? null,
    command: service.command ?? null,
    workdir: service.workdir ?? null,
    ports: [...(service.ports ?? [])],
    volumes: [...(service.volumes ?? [])],
    env: Object.entries(service.env ?? {}).sort(([keyA], [keyB]) => keyA.localeCompare(keyB)),
    dependsOn: [...(service.dependsOn ?? [])],
    healthcheck: service.healthcheck
      ? {
          command: service.healthcheck.command,
          intervalSeconds: service.healthcheck.intervalSeconds ?? null,
          timeoutSeconds: service.healthcheck.timeoutSeconds ?? null,
          retries: service.healthcheck.retries ?? null,
          startPeriodSeconds: service.healthcheck.startPeriodSeconds ?? null
        }
      : null
  };

  return createHash("sha256").update(JSON.stringify(signature)).digest("hex");
}

export async function removeContainer(name: string): Promise<void> {
  const remove = await runPodman(["rm", "-f", name]);
  if (!remove.ok) {
    throw new Error(`Failed to recreate container '${name}': ${remove.stderr || "unknown error"}`);
  }
}

export async function startContainer(name: string): Promise<void> {
  const start = await runPodman(["start", name]);
  if (!start.ok) {
    throw new Error(`Failed to start existing container '${name}': ${start.stderr || "unknown error"}`);
  }
}

function appendHealthcheckArgs(args: string[], service: LoomService): void {
  if (!service.healthcheck?.command) {
    return;
  }

  args.push("--health-cmd", service.healthcheck.command);
  args.push("--health-interval", `${service.healthcheck.intervalSeconds ?? 10}s`);
  args.push("--health-timeout", `${service.healthcheck.timeoutSeconds ?? 3}s`);
  args.push("--health-retries", String(service.healthcheck.retries ?? 5));
  args.push("--health-start-period", `${service.healthcheck.startPeriodSeconds ?? 0}s`);
}

export async function buildPodmanRunArgs(
  serviceName: string,
  containerNameValue: string,
  service: LoomService,
  networkName: string,
  expectedImage: string,
  expectedServiceHash: string,
  projectName = containerNameValue.replace(/--p\d+$/, "").slice(0, -(serviceName.length + 1))
): Promise<string[]> {
  const args: string[] = [
    "run",
    "-d",
    "--name",
    containerNameValue,
    "--network",
    networkName,
    "--network-alias",
    serviceName
  ];

  if (service.workdir) {
    args.push("-w", service.workdir);
  }

  if (service.userns) {
    args.push(`--userns=${service.userns}`);
  }

  if (service.user) {
    args.push("--user", service.user);
  }

  if (service.entrypoint !== undefined) {
    args.push("--entrypoint", service.entrypoint);
  }

  for (const port of service.ports ?? []) {
    args.push("-p", port);
  }

  await ensureBindMountParentDirs(service.volumes ?? []);

  for (const volume of service.volumes ?? []) {
    args.push("-v", volume);
  }

  for (const [key, value] of Object.entries(service.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }

  appendHealthcheckArgs(args, service);
  args.push("--label", `devroost.project=${projectName}`);
  args.push("--label", `loom.service-hash=${expectedServiceHash}`);
  args.push(expectedImage);

  if (service.command) {
    args.push("sh", "-c", service.command);
  }

  return args;
}


export async function assertContainerOwnership(
  projectName: string,
  name: string,
  inspectLabel: typeof inspectContainerLabel = inspectContainerLabel
): Promise<void> {
  const owner = await inspectLabel(name, "devroost.project");
  const missingOwner = !owner || owner === "<no value>";
  // Preserve compatibility with simple, unambiguous pre-label container names.
  if (missingOwner && !name.includes("--p")) return;
  if (owner !== projectName) {
    throw new Error(`Refusing to operate on container '${name}': expected project '${projectName}', found '${owner || "unlabeled"}'.`);
  }
}
