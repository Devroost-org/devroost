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

- `MYSQL_IMAGE=ghcr.io/loom-development/mysql-8.4@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb`
- `POSTGRES_IMAGE=ghcr.io/loom-development/postgres-16@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`
- `MONGO_IMAGE=ghcr.io/loom-development/mongo-7.0@sha256:406a4fdca9fc763443268f000218d3849ef8996f66ed9e92ba0b501b446ab822`
- `REDIS_IMAGE=ghcr.io/loom-development/redis-7.4@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`
- `SQLITE_IMAGE=ghcr.io/loom-development/loom-sqlite-3@sha256:fb5d256f745a6e26fc5a416e2491f33e02eaba00abd4d786f51a5c8e74667f07`
- `MSSQL_IMAGE=ghcr.io/loom-development/mssql-2022@sha256:ba4c8329f48fb8f02e1416be6a930ebfd71268caee78aa985f3af4315e457c89`
- `MARIADB_IMAGE=ghcr.io/loom-development/mariadb-11.8@sha256:2439dcd7d14010ecd1ff7a4e1c5abe8e208c34fe35290744deeeaac3569043c3`
- `ELASTICSEARCH_IMAGE=ghcr.io/loom-development/elasticsearch-8.19@sha256:e4797708584bd0df7c746b33a6640d243018a0ae8c8b088391c6f4675a3bef52`

## Backup and restore

Use the service name you want to target:

```bash
devroost backup postgres
devroost backup redis
devroost restore postgres ./backup.sql
devroost restore redis ./dump.rdb
```

Supported restore services in this stack are `mysql`, `postgres`, `mongodb`, `redis`, `sqlite`, and `mariadb`. `sqlserver` backup is supported, but restore is not yet available.
