import { DevroostOrchestrator } from "@devroost/core";

export async function runNamedTask(orchestrator: DevroostOrchestrator, taskName: string): Promise<void> {
  await orchestrator.runTask(taskName);
}
