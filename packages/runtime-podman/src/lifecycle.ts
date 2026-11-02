import type { LoomService } from "@loom/config";
import {
  assertContainerOwnership,
  buildPodmanRunArgs,
  containerExists,
  containerName,
  inspectContainer,
  inspectContainerImage,
  inspectContainerLabel,
  isContainerRunning,
  normalizeImage,
  removeContainer,
  serviceConfigHash,
  startContainer
} from "./containers.js";
import { runPodman, runPodmanInherit } from "./podman.js";

interface EnsureServiceStartedDependencies {
  isContainerRunningByName?: (name: string) => Promise<boolean>;
  containerExistsByName?: (name: string) => Promise<boolean>;
  inspectContainerImageByName?: (name: string) => Promise<string>;
  inspectContainerLabelByName?: (name: string, label: string) => Promise<string>;
  removeContainerByName?: (name: string) => Promise<void>;
  startContainerByName?: (name: string) => Promise<void>;
  buildRunArgs?: (
    serviceName: string,
    containerNameValue: string,
    service: LoomService,
    networkName: string,
    expectedImage: string,
    expectedServiceHash: string,
    projectName?: string
  ) => Promise<string[]>;
  runPodmanCommand?: (args: string[]) => Promise<{ ok: boolean; stderr: string }>;
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function resolveRegistryHost(image: string): string {
  const normalizedImage = normalizeImage(image);
  const [registryHost] = normalizedImage.split("/");
  return registryHost || "docker.io";
}

export function buildRegistryLoginHint(image: string): string {
  const registryHost = resolveRegistryHost(image);
  return ` Try 'podman login ${registryHost}' and verify that the image tag exists and your account can access it.`;
}

export function isRegistryAuthError(detail: string): boolean {
  return /(pull access denied|requested access to the resource is denied|authentication required|unauthorized|denied: requested access|insufficient_scope)/i.test(
    detail
  );
}

export function isImageUnavailableError(detail: string): boolean {
  return /(manifest unknown|image not known|unable to pull|error locating image|repository does not exist)/i.test(
    detail
  );
}

function isMissingBindMountSourceError(detail: string): boolean {
  return /(cannot stat .* no such file or directory|no such file or directory: oci runtime attempted to invoke a command that was not found)/i.test(
    detail
  );
}

function formatContainerRunError(name: string, image: string, detail: string): string {
  const normalizedDetail = detail.trim() || "unknown error";
  if (isRegistryAuthError(normalizedDetail)) {
    return `Failed to run container '${name}' because image '${image}' requires registry access or authentication: ${normalizedDetail}${buildRegistryLoginHint(image)}`;
  }

  if (isImageUnavailableError(normalizedDetail)) {
    return `Failed to run container '${name}' because image '${image}' is not available or could not be pulled: ${normalizedDetail}`;
  }

  return `Failed to run container '${name}': ${normalizedDetail}`;
}

export function buildExecArgs(
  containerNameValue: string,
  command: string[],
  interactiveTerminal: boolean,
  execUser?: string,
  workdir?: string
): string[] {
  if (command.length === 0) {
    throw new Error("Command required for devroost exec.");
  }

  const ttyArgs = interactiveTerminal ? ["-it"] : [];
  const workdirArgs = workdir ? ["-w", workdir] : [];
  const userArgs = execUser ? ["--user", execUser] : [];
  return ["exec", ...ttyArgs, ...workdirArgs, ...userArgs, containerNameValue, ...command];
}

export async function ensureServiceStarted(
  projectName: string,
  serviceName: string,
  service: LoomService,
  networkName: string
): Promise<void> {
  return ensureServiceStartedWithDependencies(projectName, serviceName, service, networkName);
}

export async function ensureServiceStartedWithDependencies(
  projectName: string,
  serviceName: string,
  service: LoomService,
  networkName: string,
  dependencies: EnsureServiceStartedDependencies = {}
): Promise<void> {
  const isContainerRunningByName = dependencies.isContainerRunningByName ?? isContainerRunning;
  const containerExistsByName = dependencies.containerExistsByName ?? containerExists;
  const inspectContainerImageByName = dependencies.inspectContainerImageByName ?? inspectContainerImage;
  const inspectContainerLabelByName = dependencies.inspectContainerLabelByName ?? inspectContainerLabel;
  const removeContainerByName = dependencies.removeContainerByName ?? removeContainer;
  const startContainerByName = dependencies.startContainerByName ?? startContainer;
  const buildRunArgs = dependencies.buildRunArgs ?? buildPodmanRunArgs;
  const runPodmanCommand = dependencies.runPodmanCommand ?? runPodman;
  const name = containerName(projectName, serviceName);
  const expectedImage = normalizeImage(service.image);
  const expectedServiceHash = serviceConfigHash(service);

  const legacyName = `${projectName}-${serviceName}`;
  if (legacyName !== name && !(await containerExistsByName(name)) && await containerExistsByName(legacyName)) {
    const owner = await inspectContainerLabelByName(legacyName, "devroost.project");
    if (owner === projectName) {
      // Rename the owned legacy container instead of dropping its writable layer.
      const stop = await runPodmanCommand(["stop", legacyName]);
      if (!stop.ok) throw new Error(`Failed to stop legacy container '${legacyName}': ${stop.stderr}`);
      const rename = await runPodmanCommand(["rename", legacyName, name]);
      if (!rename.ok) throw new Error(`Failed to rename legacy container '${legacyName}': ${rename.stderr}`);
    }
  }
  const running = await isContainerRunningByName(name);
  if (running) {
    await assertContainerOwnership(projectName, name, inspectContainerLabelByName);
    return;
  }

  if (await containerExistsByName(name)) {
    await assertContainerOwnership(projectName, name, inspectContainerLabelByName);
    const currentImage = await inspectContainerImageByName(name);
    const currentServiceHash = await inspectContainerLabelByName(name, "loom.service-hash");

    if (
      (currentImage && currentImage !== expectedImage) ||
      !currentServiceHash ||
      currentServiceHash !== expectedServiceHash
    ) {
      await removeContainerByName(name);
    } else {
      try {
        await startContainerByName(name);
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (!isMissingBindMountSourceError(detail)) {
          throw error;
        }

        await removeContainerByName(name);
      }
    }
  }

  const args = await buildRunArgs(
    serviceName,
    name,
    service,
    networkName,
    expectedImage,
    expectedServiceHash,
    projectName
  );

  const runResult = await runPodmanCommand(args);
  if (!runResult.ok) {
    throw new Error(formatContainerRunError(name, service.image, runResult.stderr));
  }
}

export async function stopService(projectName: string, serviceName: string): Promise<void> {
  const name = containerName(projectName, serviceName);
  const exists = await runPodman(["container", "exists", name]);
  if (!exists.ok) {
    return;
  }

  await assertContainerOwnership(projectName, name);
  const stop = await runPodman(["stop", name]);
  if (!stop.ok) {
    throw new Error(`Failed to stop container '${name}': ${stop.stderr || "unknown error"}`);
  }
}

export async function tailServiceLogs(projectName: string, serviceName: string, follow: boolean): Promise<void> {
  const name = containerName(projectName, serviceName);
  await assertContainerOwnership(projectName, name);
  const args = ["logs", ...(follow ? ["-f"] : []), name];
  const code = await runPodmanInherit(args);
  if (code !== 0) {
    throw new Error(`Failed to fetch logs for '${name}'.`);
  }
}

export async function execServiceCommand(
  projectName: string,
  serviceName: string,
  command: string[],
  execUser?: string,
  workdir?: string
): Promise<void> {
  const name = containerName(projectName, serviceName);
  await assertContainerOwnership(projectName, name);
  const args = buildExecArgs(name, command, isInteractiveTerminal(), execUser, workdir);
  const code = await runPodmanInherit(args);
  if (code !== 0) {
    throw new Error(`Failed to exec in '${name}'.`);
  }
}

interface EnsureComposerAvailableDependencies {
  inspectContainerByName?: (name: string) => Promise<{ running: boolean; state: string } | null>;
  runPodmanCommand?: (args: string[]) => Promise<{ ok: boolean; stderr: string }>;
}

function formatStoppedComposerContainerError(
  name: string,
  serviceName: string,
  state?: string
): Error {
  const stateDetail = state ? ` (state: ${state})` : "";
  return new Error(
    `Container '${name}' is not running${stateDetail}, so Composer could not be ensured. Check 'devroost logs ${serviceName} --no-follow' for the startup failure.`
  );
}

export async function ensureComposerAvailable(projectName: string, serviceName: string): Promise<void> {
  await assertContainerOwnership(projectName, containerName(projectName, serviceName));
  return ensureComposerAvailableWithDependencies(projectName, serviceName);
}

export async function ensureComposerAvailableWithDependencies(
  projectName: string,
  serviceName: string,
  dependencies: EnsureComposerAvailableDependencies = {}
): Promise<void> {
  const name = containerName(projectName, serviceName);
  const inspectContainerByName = dependencies.inspectContainerByName ?? inspectContainer;
  const runPodmanCommand = dependencies.runPodmanCommand ?? runPodman;
  const info = await inspectContainerByName(name);

  if (!info) {
    throw new Error(`Container '${name}' not found while ensuring Composer.`);
  }

  if (!info.running) {
    throw formatStoppedComposerContainerError(name, serviceName, info.state);
  }

  const result = await runPodmanCommand([
    "exec",
    name,
    "sh",
    "-c",
    "command -v composer >/dev/null 2>&1 || (EXPECTED_SIGNATURE=$(php -r \"copy('https://composer.github.io/installer.sig', 'php://stdout');\") && php -r \"copy('https://getcomposer.org/installer', 'composer-setup.php');\" && ACTUAL_SIGNATURE=$(php -r \"echo hash_file('sha384', 'composer-setup.php');\") && [ \"$EXPECTED_SIGNATURE\" = \"$ACTUAL_SIGNATURE\" ] && php composer-setup.php --install-dir=/usr/local/bin --filename=composer && rm -f composer-setup.php)"
  ]);

  if (!result.ok) {
    if (/can only create exec sessions on running containers|container state improper/i.test(result.stderr)) {
      const latestInfo = await inspectContainerByName(name);
      if (!latestInfo) {
        throw new Error(`Container '${name}' disappeared during composer check: ${result.stderr || "unknown error"}`);
      }
      if (!latestInfo.running) {
        throw formatStoppedComposerContainerError(name, serviceName, latestInfo.state);
      }
    }

    throw new Error(`Failed to ensure Composer in '${name}': ${result.stderr || "unknown error"}`);
  }
}
