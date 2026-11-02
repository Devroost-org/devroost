# MongoDB Template

This template gives you a standalone MongoDB database environment.

## Quickstart

```bash
devroost init db-mongodb --dir my-mongodb
cd my-mongodb
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${MONGO_IMAGE:-ghcr.io/loom-development/mongo-7.0@sha256:406a4fdca9fc763443268f000218d3849ef8996f66ed9e92ba0b501b446ab822}`
  - Port: `27017`

## Route

- None

## Image overrides

- `MONGO_IMAGE`

## Backup and restore

```bash
devroost backup db
devroost restore db ./backup.archive.gz
```
