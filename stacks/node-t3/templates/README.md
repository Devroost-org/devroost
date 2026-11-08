# T3 Template

This template gives you a T3-style full-stack setup with Next.js, TypeScript, and PostgreSQL.

## Quickstart

```bash
devroost init node-t3 --dir my-t3
cd my-t3
devroost start
devroost status
```

## Services

- `db`
  - Port: `5434`
- `app`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:47887d26da9d5e31892f351297e03004ffd61f2d5c443ca4e56d89768e365f5c}`
  - Port: `3003`
  - Purpose: Next.js app server

## Route

- App: `https://t3.devroost.local`

## Image overrides

- `NODE_IMAGE`
