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
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5b3b1780892e2701df00b8f37d9a7e49c910992b58bffed95ccfb7ba58875402}`
  - Port: `3003`
  - Purpose: Next.js app server

## Route

- App: `https://t3.devroost.local`

## Image overrides

- `NODE_IMAGE`
