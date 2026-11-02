import {
  backupExtensionForServiceType,
  backupServiceToFile,
  restoreServiceFromFile,
  SUPPORTED_RESTORE_SERVICE_TYPES,
  SUPPORTED_BACKUP_SERVICE_TYPES,
  containerName,
  detectPodmanCapabilities,
  ensureComposerAvailable,
  ensureMachineRunning,
  ensureServiceStarted,
  execServiceCommand,
  inspectContainer,
  isContainerRunning,
  listProjectContainers,
  removeContainer,
  stopService,
  tailServiceLogs,
  waitForServiceReady
} from "@devroost/runtime-podman";
import {
  ensureRouteHosts,
  ensureRouteProxy,
  ensureServiceNetwork,
  resolveRouteBindings,
  stopRouteHosts,
  stopRouteProxy
} from "@devroost/network";
import { ensureLocalCertificates } from "@devroost/https";

export interface OrchestratorDependencies {
  backupExtensionForServiceType: typeof backupExtensionForServiceType;
  backupServiceToFile: typeof backupServiceToFile;
  restoreServiceFromFile: typeof restoreServiceFromFile;
  supportedBackupServiceTypes: typeof SUPPORTED_BACKUP_SERVICE_TYPES;
  supportedRestoreServiceTypes: typeof SUPPORTED_RESTORE_SERVICE_TYPES;
  containerName: typeof containerName;
  detectPodmanCapabilities: typeof detectPodmanCapabilities;
  ensureComposerAvailable: typeof ensureComposerAvailable;
  ensureLocalCertificates: typeof ensureLocalCertificates;
  ensureMachineRunning: typeof ensureMachineRunning;
  ensureRouteProxy: typeof ensureRouteProxy;
  ensureRouteHosts: typeof ensureRouteHosts;
  ensureServiceNetwork: typeof ensureServiceNetwork;
  ensureServiceStarted: typeof ensureServiceStarted;
  execServiceCommand: typeof execServiceCommand;
  inspectContainer: typeof inspectContainer;
  isContainerRunning: typeof isContainerRunning;
  listProjectContainers: typeof listProjectContainers;
  removeContainer: typeof removeContainer;
  resolveRouteBindings: typeof resolveRouteBindings;
  stopRouteProxy: typeof stopRouteProxy;
  stopRouteHosts: typeof stopRouteHosts;
  stopService: typeof stopService;
  tailServiceLogs: typeof tailServiceLogs;
  waitForServiceReady: typeof waitForServiceReady;
}

export const defaultOrchestratorDependencies: OrchestratorDependencies = {
  backupExtensionForServiceType,
  backupServiceToFile,
  restoreServiceFromFile,
  supportedBackupServiceTypes: SUPPORTED_BACKUP_SERVICE_TYPES,
  supportedRestoreServiceTypes: SUPPORTED_RESTORE_SERVICE_TYPES,
  containerName,
  detectPodmanCapabilities,
  ensureComposerAvailable,
  ensureLocalCertificates,
  ensureMachineRunning,
  ensureRouteHosts,
  ensureRouteProxy,
  ensureServiceNetwork,
  ensureServiceStarted,
  execServiceCommand,
  inspectContainer,
  isContainerRunning,
  listProjectContainers,
  removeContainer,
  resolveRouteBindings,
  stopRouteHosts,
  stopRouteProxy,
  stopService,
  tailServiceLogs,
  waitForServiceReady
};