# SQL Server Template

This template gives you a standalone SQL Server database environment for local development.

## Quickstart

```bash
devroost init db-sqlserver --dir my-sqlserver
cd my-sqlserver
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${MSSQL_IMAGE:-ghcr.io/devroost-org/mssql-2022@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090}`
  - Port: `1433`

## Route

- None

## Image overrides

- `MSSQL_IMAGE`

## Backup and restore

```bash
devroost backup db
```

SQL Server backup is supported. `devroost restore` is not yet available for SQL Server because the current backup format is a live `.bak` of `master`, which needs a different restore flow.
