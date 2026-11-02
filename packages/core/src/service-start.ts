import type { DevroostConfig } from "@devroost/config";
import type { OrchestratorDependencies } from "./dependencies.js";
import type { OrchestratorOutput } from "./output.js";
import { formatStartedService, formatWaitingService } from "./startup.js";

type ServiceStartDependencies = Pick<
  OrchestratorDependencies,
  "ensureComposerAvailable" | "ensureServiceStarted" | "waitForServiceReady"
>;

type ServiceStartOutput = Pick<OrchestratorOutput, "writeOut">;

export async function startConfiguredService(
  config: DevroostConfig,
  serviceName: string,
  networkName: string,
  dependencies: ServiceStartDependencies,
  output: ServiceStartOutput
): Promise<void> {
  const service = config.services[serviceName];
  await dependencies.ensureServiceStarted(config.name, serviceName, service, networkName);

  if (service.type.toLowerCase() === "php" && service.composer !== false) {
    await dependencies.ensureComposerAvailable(config.name, serviceName);
  }

  await dependencies.waitForServiceReady(config.name, serviceName, {
    ...service.healthcheck,
    ports: service.ports,
    progressIntervalSeconds: 15,
    onProgress(progress) {
      output.writeOut(formatWaitingService(serviceName, progress.detail, progress.elapsedSeconds));
    }
  });
  output.writeOut(formatStartedService(serviceName));
}