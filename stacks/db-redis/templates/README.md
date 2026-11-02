# Redis Template

This template gives you a standalone Redis environment with persistence enabled.

## Quickstart

```bash
devroost init db-redis --dir my-redis
cd my-redis
devroost start
devroost status
```

## Service

- `db`
  - Runtime: `${REDIS_IMAGE:-ghcr.io/devroost-org/redis-7.4@sha256:8da19c7399dca900c6822a1cf30f9d2285585e2c4b457ff4095b0f4500054d3f}`
  - Port: `6379`

## Route

- None

## Image overrides

- `REDIS_IMAGE`

## Backup and restore

```bash
devroost backup db
devroost restore db ./dump.rdb
```

`devroost restore` stops Redis, replaces `dump.rdb`, and starts the service again automatically.
