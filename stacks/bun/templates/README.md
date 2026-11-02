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
  - Runtime: `${BUN_IMAGE:-ghcr.io/devroost-org/devroost-bun-1@sha256:0a6a1bd48cebd98167d215756f7cdea48d3a0e568003c6dcaf0cfc453188fe48}`
  - Port: `3004`
  - Purpose: Bun development server

## Route

- App: `https://bun.devroost.local`

## Image overrides

- `BUN_IMAGE`
