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
  - Runtime: `${MONGO_IMAGE:-ghcr.io/devroost-org/mongo-7.0@sha256:94aea1479556ad4e5aba7a31a6d53eb7b0ae76741950da45a13d5df5cddf1b3b}`
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
