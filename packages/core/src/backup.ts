import type { DevroostConfig } from "@devroost/config";
import { resolve } from "node:path";
import type { OrchestratorDependencies } from "./dependencies.js";
import { requireConfiguredService } from "./services.js";

export function listBackupSupportedServices(
  config: DevroostConfig,
  backupExtensionForServiceType: (serviceType: string) => string | null
): Array<[string, DevroostConfig["services"][string]]> {
  return Object.entries(config.services).filter(([, service]) =>
    Boolean(backupExtensionForServiceType(service.type))
  );
}

export function requireBackupExtension(
  serviceName: string,
  serviceType: string,
  supportedBackupServiceTypes: readonly string[],
  backupExtensionForServiceType: (serviceType: string) => string | null
): string {
  const extension = backupExtensionForServiceType(serviceType);
  if (!extension) {
    throw new Error(
      `Service '${serviceName}' has type '${serviceType}', which is not currently supported by 'devroost backup'. Supported types: ${supportedBackupServiceTypes.join(", ")}.`
    );
  }

  return extension;
}

export function resolveBackupOutputPath(
  projectRoot: string,
  projectName: string,
  serviceName: string,
  extension: string,
  outputPath?: string,
  now: Date = new Date()
): string {
  if (outputPath) {
    return resolve(projectRoot, outputPath);
  }

  const timestamp = now.toISOString().replace(/[:]/g, "-");
  return resolve(
    projectRoot,
    ".devroost",
    "backups",
    `${projectName}-${serviceName}-${timestamp}.${extension}`
  );
}

type BackupDependencies = Pick<
  OrchestratorDependencies,
  | "backupExtensionForServiceType"
  | "backupServiceToFile"
  | "listProjectContainers"
  | "supportedBackupServiceTypes"
>;

export async function backupConfiguredService(
  config: DevroostConfig,
  projectRoot: string,
  serviceName: string,
  dependencies: BackupDependencies,
  outputPath?: string
): Promise<string> {
  const service = await requireConfiguredService(
    config,
    serviceName,
    dependencies.listProjectContainers
  );

  const extension = requireBackupExtension(
    serviceName,
    service.type,
    dependencies.supportedBackupServiceTypes,
    dependencies.backupExtensionForServiceType
  );
  const finalPath = resolveBackupOutputPath(
    projectRoot,
    config.name,
    serviceName,
    extension,
    outputPath
  );
  await dependencies.backupServiceToFile(config.name, serviceName, service, finalPath);
  return finalPath;
}

export async function backupAllConfiguredServices(
  config: DevroostConfig,
  projectRoot: string,
  dependencies: BackupDependencies
): Promise<Array<{ service: string; path: string }>> {
  const supported = listBackupSupportedServices(config, dependencies.backupExtensionForServiceType);

  if (supported.length === 0) {
    throw new Error(
      `No backup-supported services found in devroost.yaml. Supported types: ${dependencies.supportedBackupServiceTypes.join(", ")}.`
    );
  }

  const results: Array<{ service: string; path: string }> = [];
  for (const [serviceName] of supported) {
    const path = await backupConfiguredService(
      config,
      projectRoot,
      serviceName,
      dependencies
    );
    results.push({ service: serviceName, path });
  }

  return results;
}