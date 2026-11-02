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
  - Runtime: `${POSTGRES_IMAGE:-ghcr.io/devroost-org/postgres-16@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab}`
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
