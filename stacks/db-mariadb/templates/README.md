# MariaDB Template

This template gives you a standalone MariaDB database environment.

## Quickstart

```bash
devroost init db-mariadb --dir my-mariadb
cd my-mariadb
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${MARIADB_IMAGE:-ghcr.io/devroost-org/mariadb-11.8@sha256:c4124d1afa875e47f2892edf26b482fa54f796e2f342d3717a04ca091a22a9bd}`
  - Port: `3307`

## Route

- None

## Image overrides

- `MARIADB_IMAGE`

## Backup and restore

```bash
devroost backup db
devroost restore db ./backup.sql
```
