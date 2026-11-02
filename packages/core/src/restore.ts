import type { DevroostConfig } from "@devroost/config";
import { resolve } from "node:path";
import type { OrchestratorDependencies } from "./dependencies.js";
import { requireConfiguredService } from "./services.js";

type RestoreDependencies = Pick<
  OrchestratorDependencies,
  | "listProjectContainers"
  | "ensureServiceNetwork"
  | "restoreServiceFromFile"
  | "ensureServiceStarted"
  | "waitForServiceReady"
  | "stopService"
  | "supportedRestoreServiceTypes"
>;

export function resolveRestoreInputPath(projectRoot: string, inputPath: string): string {
  return resolve(projectRoot, inputPath);
}

export function requireRestoreSupport(
  serviceName: string,
  serviceType: string,
  supportedRestoreServiceTypes: readonly string[]
): void {
  const normalizedType = serviceType.toLowerCase();
  if (normalizedType === "sqlserver" || normalizedType === "mssql") {
    throw new Error(
      `Service '${serviceName}' has type '${serviceType}', but SQL Server restore is not yet supported by 'devroost restore'. The current SQL Server backup format is a live .bak of 'master', which is not safely restorable through the running container flow Devroost uses today.`
    );
  }

  if (supportedRestoreServiceTypes.includes(normalizedType)) {
    return;
  }

  throw new Error(
    `Service '${serviceName}' has type '${serviceType}', which is not currently supported by 'devroost restore'. Supported types: ${supportedRestoreServiceTypes.join(", ")}.`
  );
}

export async function restoreConfiguredService(
  config: DevroostConfig,
  projectRoot: string,
  serviceName: string,
  inputPath: string,
  dependencies: RestoreDependencies
): Promise<string> {
  const service = await requireConfiguredService(
    config,
    serviceName,
    dependencies.listProjectContainers
  );

  requireRestoreSupport(serviceName, service.type, dependencies.supportedRestoreServiceTypes);
  const finalInputPath = resolveRestoreInputPath(projectRoot, inputPath);

  if (service.type.toLowerCase() === "redis") {
    await dependencies.stopService(config.name, serviceName);
    await dependencies.restoreServiceFromFile(config.name, serviceName, service, finalInputPath);
    const networkName = await dependencies.ensureServiceNetwork(config);
    await dependencies.ensureServiceStarted(config.name, serviceName, service, networkName);
    await dependencies.waitForServiceReady(config.name, serviceName, {
      ...service.healthcheck,
      ports: service.ports,
      progressIntervalSeconds: 15
    });
    return finalInputPath;
  }

  await dependencies.restoreServiceFromFile(config.name, serviceName, service, finalInputPath);
  return finalInputPath;
}