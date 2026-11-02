import { containerName } from "@loom/runtime-podman";
import type { LoomConfig } from "@loom/config";
import { closestServiceName } from "./utils.js";

type ConfiguredService = LoomConfig["services"][string];

interface ContainerLike {
  name: string;
  running: boolean;
}

export function getConfiguredService(
  config: LoomConfig,
  serviceName: string
): ConfiguredService | undefined {
  return config.services[serviceName];
}

export async function buildServiceNotFoundError(
  config: LoomConfig,
  serviceName: string,
  listProjectContainersByProject: (projectName: string) => Promise<ContainerLike[]>
): Promise<Error> {
  const availableServices = Object.keys(config.services).sort();
  const containers = await listProjectContainersByProject(config.name);
  const runningNames = new Set(containers.filter((container) => container.running).map((container) => container.name));
  const runningServices = Object.keys(config.services)
    .filter((service) => runningNames.has(containerName(config.name, service)))
    .sort();

  const availableMessage = availableServices.length > 0 ? availableServices.join(", ") : "none";
  const runningMessage = runningServices.length > 0 ? runningServices.join(", ") : "none";
  const closestMatch = closestServiceName(serviceName, availableServices);
  const suggestion = closestMatch ? ` Did you mean '${closestMatch}'?` : "";

  return new Error(
    `Service '${serviceName}' is not defined in devroost.yaml.${suggestion} Available services: ${availableMessage}. Running services: ${runningMessage}.`
  );
}

export async function requireConfiguredService(
  config: LoomConfig,
  serviceName: string,
  listProjectContainersByProject: (projectName: string) => Promise<ContainerLike[]>
): Promise<ConfiguredService> {
  const service = getConfiguredService(config, serviceName);
  if (service) {
    return service;
  }

  throw await buildServiceNotFoundError(config, serviceName, listProjectContainersByProject);
}