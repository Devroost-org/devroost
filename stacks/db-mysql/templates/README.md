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
  - Runtime: `${MYSQL_IMAGE:-ghcr.io/devroost-org/mysql-8.4@sha256:200b8d4d14f72cb6dbea7686a14d8591f5b5fb3e0b83a1a662dc9094efa1bbf0}`
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
