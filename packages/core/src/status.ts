import type { DevroostConfig } from "@devroost/config";
import type { OrchestratorDependencies } from "./dependencies.js";

export interface DevroostStatus {
  project: string;
  podman: {
    available: boolean;
    version?: string;
    rootless: boolean;
    machineRunning: boolean;
  };
  services: Array<{
    name: string;
    image: string;
    container: string;
    running: boolean;
    state?: string;
    health?: string;
  }>;
  routes: Array<{
    host: string;
    target: string;
    https: boolean;
  }>;
  https?: {
    certPath: string;
    keyPath: string;
  };
  proxy?: {
    httpPort: number;
    httpsPort: number;
  };
}

export async function buildDevroostStatus(
  config: DevroostConfig,
  dependencies: Pick<
    OrchestratorDependencies,
    | "containerName"
    | "detectPodmanCapabilities"
    | "ensureLocalCertificates"
    | "inspectContainer"
    | "isContainerRunning"
    | "resolveRouteBindings"
  >
): Promise<DevroostStatus> {
  const capabilities = await dependencies.detectPodmanCapabilities();
  const routes = dependencies.resolveRouteBindings(config);
  const httpsHosts = routes.filter((route) => route.https).map((route) => route.host);
  const https =
    httpsHosts.length > 0
      ? await dependencies.ensureLocalCertificates(config.name, httpsHosts)
      : undefined;

  return {
    project: config.name,
    podman: {
      available: capabilities.available,
      version: capabilities.version,
      rootless: capabilities.rootless,
      machineRunning: capabilities.machine.running
    },
    services: await Promise.all(
      Object.entries(config.services).map(async ([name, service]) => {
        const container = dependencies.containerName(config.name, name);
        const inspected = await dependencies.inspectContainer(container);

        return {
          name,
          image: service.image,
          container,
          running: await dependencies.isContainerRunning(container),
          state: inspected?.state,
          health: inspected?.health
        };
      })
    ),
    routes: routes.map((route) => ({
      host: route.host,
      target: `${route.service}:${route.targetPort}`,
      https: route.https
    })),
    https,
    proxy: routes.length > 0 ? { httpPort: 8080, httpsPort: 8443 } : undefined
  };
}