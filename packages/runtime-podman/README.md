# @loom/runtime-podman

Podman runtime adapter for Loom.

- Container/network lifecycle helpers
- Readiness checks
- Exec/log/backup primitives
- Internal modules are split by concern and re-exported through the package root.
- Public imports remain available from the package root so downstream packages do not need to change.

## Internal module boundaries

- `src/podman.ts`: low-level Podman command execution helpers.
- `src/containers.ts`: container naming, inspection, config hashing, host-port parsing, and run-argument assembly.
- `src/lifecycle.ts`: service startup and stop flows, exec/log helpers, and Composer bootstrap support.
- `src/readiness.ts`: readiness polling and port reachability checks.
- `src/backup.ts`: backup strategy selection and streaming backups to files.
- `src/machine.ts`: Podman capability detection and managed machine startup.
- `src/types.ts`: shared runtime helper types.

## Design intent

The package keeps a stable public surface through `src/index.ts`, while the internal split keeps Podman command execution, container inspection, lifecycle decisions, and backup/readiness behavior independently testable.

New service containers carry a `loom.project` label. Project listings and bulk
recreation select that exact label, avoiding overlapping project-name prefixes.
Older unlabeled containers are excluded from bulk deletion; remove those
containers explicitly by their exact names and run `loom start` to recreate them
with ownership labels. Bind-mounted database data is preserved by container removal.

Redis restore requires a stopped primary container. A temporary container uses the
same data volume to validate and load the RDB snapshot, then rebuild its append-only
log before the primary restarts. PostgreSQL restores stop and report failure at
the first SQL error.

Run `pnpm typecheck` followed by `node scripts/runtime-regression.mjs` from the
repository root for live ownership, Redis, PostgreSQL, and Caddy checks. These
checks require Podman, OpenSSL, and the referenced container images. They publish
no host ports and remove their own temporary containers and volumes afterward.

Container names include a project-length suffix when either identifier contains a
hyphen, so project `shop` / service `api-web` differs from project `shop-api` /
service `web`. Lifecycle operations check project ownership. Startup migrates
owned containers using the older ambiguous names by stopping and renaming them;
it preserves their writable layers and attached volumes.

SQLite backups use the SQLite online backup command, including committed data
that is still in the WAL. The live regression script also checks this case.
