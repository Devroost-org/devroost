import { Socket } from "node:net";
import { containerName, inspectContainer, parseHostPorts } from "./containers.js";
import type { ContainerSummary } from "./types.js";

export interface ServiceReadinessOptions {
  command?: string;
  ports?: string[];
  intervalSeconds?: number;
  timeoutSeconds?: number;
  retries?: number;
  startPeriodSeconds?: number;
  progressIntervalSeconds?: number;
  onProgress?: (progress: { elapsedSeconds: number; detail: string }) => void;
}

interface WaitForServiceReadyDependencies {
  inspectContainerByName?: (name: string) => Promise<ContainerSummary | null>;
  sleep?: (ms: number) => Promise<void>;
  arePortsReachable?: (ports: number[], timeoutMs: number) => Promise<boolean>;
  now?: () => number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isPortOpen(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const cleanup = () => { socket.removeAllListeners(); socket.destroy(); };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => { cleanup(); resolve(true); });
    socket.once("timeout", () => { cleanup(); resolve(false); });
    socket.once("error", () => { cleanup(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

export async function arePortsReachable(ports: number[], timeoutMs: number): Promise<boolean> {
  if (ports.length === 0) {
    return false;
  }

  const results = await Promise.all(ports.map((port) => isPortOpen(port, timeoutMs)));
  return results.every(Boolean);
}

export async function waitForServiceReady(
  projectName: string,
  serviceName: string,
  options?: ServiceReadinessOptions
): Promise<void> {
  return waitForServiceReadyWithDependencies(projectName, serviceName, options);
}

export async function waitForServiceReadyWithDependencies(
  projectName: string,
  serviceName: string,
  options: ServiceReadinessOptions | undefined,
  dependencies: WaitForServiceReadyDependencies = {}
): Promise<void> {
  const inspectContainerByName = dependencies.inspectContainerByName ?? inspectContainer;
  const delay = dependencies.sleep ?? sleep;
  const portsReachable = dependencies.arePortsReachable ?? arePortsReachable;
  const now = dependencies.now ?? Date.now;
  const name = containerName(projectName, serviceName);
  const {
    startPeriodSeconds = 0,
    intervalSeconds = 2,
    progressIntervalSeconds = 15,
    retries = 30,
    timeoutSeconds = 2,
    ports = [],
    command
  } = options ?? {};

  const startPeriodMs = startPeriodSeconds * 1000;
  const intervalMs = Math.max(intervalSeconds * 1000, 100);
  const progressIntervalMs = Math.max(progressIntervalSeconds * 1000, intervalMs);
  const graceAttempts = Math.ceil(startPeriodMs / intervalMs);
  const maxAttempts = Math.max(retries + graceAttempts, 1);
  const timeoutMs = Math.max(startPeriodMs + retries * intervalMs, 60_000);
  const probeTimeoutMs = timeoutSeconds * 1000;
  const hostPorts = parseHostPorts(ports);
  const hasExplicitReadinessProbe = Boolean(command) || hostPorts.length > 0;
  const stableRunningChecksRequired = hasExplicitReadinessProbe ? 1 : 2;
  let stableRunningChecks = 0;

  let attempts = 0;
  const startedAt = now();
  let lastProgressAt = startedAt - progressIntervalMs;

  while (attempts < maxAttempts && now() - startedAt <= timeoutMs) {
    attempts += 1;
    const info = await inspectContainerByName(name);
    if (!info) {
      throw new Error(`Container '${name}' not found while waiting for readiness.`);
    }

    if (!info.running) {
      throw new Error(
        `Container '${name}' exited before becoming ready. Check 'devroost logs ${serviceName} --no-follow' for the startup failure.`
      );
    }

    stableRunningChecks += 1;

    const elapsedMs = now() - startedAt;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const withinStartPeriod = elapsedMs < startPeriodMs;

    if (info.health) {
      if (info.health.toLowerCase() === "healthy") {
        return;
      }

      if (info.health.toLowerCase() === "unhealthy") {
        if (withinStartPeriod) {
          if (now() - lastProgressAt >= progressIntervalMs) {
            options?.onProgress?.({
              elapsedSeconds,
              detail: "healthcheck is still settling during startup grace period"
            });
            lastProgressAt = now();
          }

          await delay(intervalMs);
          continue;
        }

        throw new Error(`Container '${name}' reported unhealthy status.`);
      }

      if (now() - lastProgressAt >= progressIntervalMs) {
        options?.onProgress?.({
          elapsedSeconds,
          detail: `health: ${info.health.toLowerCase()}`
        });
        lastProgressAt = now();
      }

      await delay(intervalMs);
      continue;
    }

    if (hostPorts.length > 0) {
      const reachable = await portsReachable(hostPorts, probeTimeoutMs);
      if (reachable) {
        return;
      }

      if (now() - lastProgressAt >= progressIntervalMs) {
        options?.onProgress?.({
          elapsedSeconds,
          detail: `waiting for ports ${hostPorts.join(", ")} to accept connections`
        });
        lastProgressAt = now();
      }

      await delay(intervalMs);
      continue;
    }

    if (stableRunningChecks >= stableRunningChecksRequired) {
      return;
    }

    if (now() - lastProgressAt >= progressIntervalMs) {
      options?.onProgress?.({
        elapsedSeconds,
        detail: `container running; waiting for stability check ${stableRunningChecks}/${stableRunningChecksRequired}`
      });
      lastProgressAt = now();
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for service '${serviceName}' to become ready.`);
}