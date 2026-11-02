# PostgreSQL Template

This template gives you a standalone PostgreSQL database environment.

## Quickstart

```bash
devroost init db-postgres --dir my-postgres
cd my-postgres
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${POSTGRES_IMAGE:-ghcr.io/loom-development/postgres-16@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685}`
  - Port: `5432`

## Route

- None

## Image overrides

- `POSTGRES_IMAGE`

## Backup and restore

```bash
devroost backup db
devroost restore db ./backup.sql
```
