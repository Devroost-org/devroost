import type { DevroostConfig, DevroostTask } from "@devroost/config";

export function getConfiguredTask(
  config: DevroostConfig,
  taskName: string
): DevroostTask | undefined {
  return config.tasks?.[taskName];
}

export function requireConfiguredTask(
  config: DevroostConfig,
  taskName: string
): DevroostTask {
  const task = getConfiguredTask(config, taskName);
  if (!task) {
    throw new Error(`Task '${taskName}' is not defined in devroost.yaml.`);
  }

  return task;
}