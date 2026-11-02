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
  - Runtime: `${REDIS_IMAGE:-ghcr.io/devroost-org/redis-7.4@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf}`
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
