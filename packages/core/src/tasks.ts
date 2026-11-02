import type { LoomConfig, LoomTask } from "@loom/config";

export function getConfiguredTask(
  config: LoomConfig,
  taskName: string
): LoomTask | undefined {
  return config.tasks?.[taskName];
}

export function requireConfiguredTask(
  config: LoomConfig,
  taskName: string
): LoomTask {
  const task = getConfiguredTask(config, taskName);
  if (!task) {
    throw new Error(`Task '${taskName}' is not defined in devroost.yaml.`);
  }

  return task;
}