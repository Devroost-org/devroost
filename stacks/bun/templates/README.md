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
  - Runtime: `${BUN_IMAGE:-ghcr.io/devroost-org/devroost-bun-1@sha256:abd226888f2a3ee913344acec1be36e96b0832858932ce2e2f2a0b09dd0131c0}`
  - Port: `3004`
  - Purpose: Bun development server

## Route

- App: `https://bun.devroost.local`

## Image overrides

- `BUN_IMAGE`
