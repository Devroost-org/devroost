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
  - Runtime: `${MSSQL_IMAGE:-ghcr.io/devroost-org/mssql-2022@sha256:ba4c8329f48fb8f02e1416be6a930ebfd71268caee78aa985f3af4315e457c89}`
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
