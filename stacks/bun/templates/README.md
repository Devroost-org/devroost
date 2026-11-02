# Bun Template

This template gives you a Bun-based application workflow as a Node.js alternative, with Bun's built-in server handling both HTML and JSON endpoints.

## Quickstart

```bash
devroost init bun --dir my-bun
cd my-bun
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${BUN_IMAGE:-ghcr.io/devroost-org/devroost-bun-1@sha256:4d640f6c2554c4ba738d1713dbec45be112cd59f6939d53fef7dc5ec78d9acda}`
  - Port: `3004`
  - Purpose: Bun development server

## Route

- App: `https://bun.devroost.local`

## Image overrides

- `BUN_IMAGE`
