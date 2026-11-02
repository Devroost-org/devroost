# SQLite Template

This template gives you a lightweight SQLite environment stored as a local file.

## Quickstart

```bash
devroost init db-sqlite --dir my-sqlite
cd my-sqlite
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${SQLITE_IMAGE:-ghcr.io/devroost-org/devroost-sqlite-3@sha256:98a568db611c27ddaa23a570f5710161d7e1a38f921769ae1b41c2f4a45861fd}`
  - Port: none
  - Purpose: create and expose the SQLite database file under the project data directory

## Route

- None

## Image overrides

- `SQLITE_IMAGE`

## Backup and restore

```bash
devroost backup db
devroost restore db ./devroost.db
```

SQLite restore replaces the mounted database file directly.
