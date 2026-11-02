# MySQL Template

This template gives you a standalone MySQL database environment.

## Quickstart

```bash
devroost init db-mysql --dir my-mysql
cd my-mysql
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${MYSQL_IMAGE:-ghcr.io/devroost-org/mysql-8.4@sha256:221c78806de3686d3fb4569df99af86bdb0f5cf4f7087e1e2d9c4527fa5e681a}`
  - Port: `3306`

## Route

- None

## Image overrides

- `MYSQL_IMAGE`

## Backup and restore

```bash
devroost backup db
devroost restore db ./backup.sql
```
