import { existsSync } from "node:fs";
import type { LoomConfig } from "@loom/config";
import type { OrchestratorDependencies } from "./dependencies.js";

type RuntimeDependencies = Pick<
  OrchestratorDependencies,
  "ensureMachineRunning" | "detectPodmanCapabilities"
> & {
  platform?: NodeJS.Platform;
  runtimeDirExists?: (path: string) => boolean;
  runtimeDir?: string;
  uid?: number;
};

function rootlessRuntimePath(uid: number, runtimeDir?: string): string {
  return runtimeDir || process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
}

function assertLinuxRootlessRuntimeReady(
  config: LoomConfig,
  dependencies: RuntimeDependencies
): void {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "linux" || !config.runtime.rootless) {
    return;
  }

  const uid = dependencies.uid ?? process.getuid?.();
  if (uid === undefined) {
    return;
  }

  const runtimeDir = rootlessRuntimePath(uid, dependencies.runtimeDir);
  const runtimeDirExists = dependencies.runtimeDirExists ?? existsSync;

  if (runtimeDirExists(runtimeDir)) {
    return;
  }

  throw new Error(
    `Rootless Podman requires a writable user runtime directory, but '${runtimeDir}' does not exist. ` +
      `Log in with a real user session or enable lingering with 'loginctl enable-linger ${uid}', then retry 'devroost start'.`
  );
}

export async function ensureRuntimeReady(
  config: LoomConfig,
  dependencies: RuntimeDependencies
): Promise<void> {
  assertLinuxRootlessRuntimeReady(config, dependencies);
  await dependencies.ensureMachineRunning(config.runtime.machine?.managed ?? true);
  const capabilities = await dependencies.detectPodmanCapabilities();

  if (!capabilities.available) {
    throw new Error("Podman is unavailable. Install Podman and retry `devroost start`.");
  }

  if (config.runtime.rootless && !capabilities.rootless) {
    throw new Error("Devroost config requires rootless Podman, but Podman is running rootful.");
  }
}