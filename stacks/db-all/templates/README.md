# All Databases Template

This template gives you a single local project with multiple database services at once.

## Quickstart

```bash
devroost init db-all --dir my-databases
cd my-databases
devroost start
devroost status
```

## Services

- `mysql` on `3306`
- `postgres` on `5432`
- `mongodb` on `27017`
- `redis` on `6379`
- `sqlite` as a local file-backed service
- `sqlserver` on `1433`
- `mariadb` on `3307`
- `elasticsearch` on `9200` and `9300`

## Route

- None

## Image overrides

- `MYSQL_IMAGE=ghcr.io/devroost-org/mysql-8.4@sha256:200b8d4d14f72cb6dbea7686a14d8591f5b5fb3e0b83a1a662dc9094efa1bbf0`
- `POSTGRES_IMAGE=ghcr.io/devroost-org/postgres-16@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab`
- `MONGO_IMAGE=ghcr.io/devroost-org/mongo-7.0@sha256:94aea1479556ad4e5aba7a31a6d53eb7b0ae76741950da45a13d5df5cddf1b3b`
- `REDIS_IMAGE=ghcr.io/devroost-org/redis-7.4@sha256:8da19c7399dca900c6822a1cf30f9d2285585e2c4b457ff4095b0f4500054d3f`
- `SQLITE_IMAGE=ghcr.io/devroost-org/devroost-sqlite-3@sha256:3f4b2421a867320ec0fdd7ae60d3106fde34afb95ceadbb78f94871ffc7b3af4`
- `MSSQL_IMAGE=ghcr.io/devroost-org/mssql-2022@sha256:4402d880dd4c34bfa7d8705e56a86cd6c88da80a1f6bbbe741f999e76264a090`
- `MARIADB_IMAGE=ghcr.io/devroost-org/mariadb-11.8@sha256:c4124d1afa875e47f2892edf26b482fa54f796e2f342d3717a04ca091a22a9bd`
- `ELASTICSEARCH_IMAGE=ghcr.io/devroost-org/elasticsearch-8.19@sha256:4d0724bb8d78d7a2330693623e26ca4d621079d062ecc8a30b3e1fc180ec14c1`

## Backup and restore

Use the service name you want to target:

```bash
devroost backup postgres
devroost backup redis
devroost restore postgres ./backup.sql
devroost restore redis ./dump.rdb
```

Supported restore services in this stack are `mysql`, `postgres`, `mongodb`, `redis`, `sqlite`, and `mariadb`. `sqlserver` backup is supported, but restore is not yet available.
