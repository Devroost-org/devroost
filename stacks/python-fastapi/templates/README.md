# FastAPI Template

This template gives you a minimal FastAPI application running from local source files.

## Quickstart

```bash
devroost init python-fastapi --dir my-fastapi
cd my-fastapi
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${PYTHON_IMAGE:-ghcr.io/devroost-org/devroost-python-3.12@sha256:dfc56d79d2e1ec7552b172f58bab8468929cf80dca40a33078654bc5fb8d9a94}`
  - Port: `8003`
  - Purpose: FastAPI development server

## Route

- App: `https://fastapi.devroost.local`

## Image overrides

- `PYTHON_IMAGE`
