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
  - Runtime: `${SQLITE_IMAGE:-ghcr.io/devroost-org/devroost-sqlite-3@sha256:3f4b2421a867320ec0fdd7ae60d3106fde34afb95ceadbb78f94871ffc7b3af4}`
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
