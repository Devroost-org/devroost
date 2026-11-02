# @loom/core

Core orchestration layer for Devroost.

- Start/stop/restart orchestration
- Service/task/backup coordination
- Runtime and route integration
- Public API remains centered on `LoomOrchestrator`; internal orchestration logic is split into focused helper modules.

## Internal module boundaries

- `src/runtime.ts`: runtime readiness checks before startup begins.
- `src/service-start.ts`: per-service startup, PHP composer bootstrap, readiness waiting, and startup output.
- `src/routes.ts`: route publishing, HTTPS certificate lookup, proxy setup, and startup route summaries.
- `src/backup.ts`: backup support detection, output path resolution, and backup execution flows.
- `src/status.ts`: status assembly from config, runtime inspection, routes, and HTTPS metadata.
- `src/services.ts` and `src/tasks.ts`: validated lookup helpers and user-facing not-found errors.
- `src/startup.ts`: startup summary formatting helpers.
- `src/lifecycle.ts`: stop-flow orchestration shared by `stop()` and `restart()`.
- `src/dependencies.ts` and `src/output.ts`: injectable side-effect boundaries used by tests and orchestration.

## Design intent

`src/index.ts` is intentionally kept as a thin facade over the public orchestrator methods. The helper modules above isolate policy and formatting from process orchestration so behavior can be tested directly without real Podman, network, or HTTPS side effects.
