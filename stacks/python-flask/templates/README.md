# Flask Template

This template gives you a minimal Flask application running from local source files.

## Quickstart

```bash
devroost init python-flask --dir my-flask
cd my-flask
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${PYTHON_IMAGE:-ghcr.io/devroost-org/devroost-python-3.12@sha256:dfc56d79d2e1ec7552b172f58bab8468929cf80dca40a33078654bc5fb8d9a94}`
  - Port: `8002`
  - Purpose: Flask development server

## Route

- App: `https://flask.devroost.local`

## Image overrides

- `PYTHON_IMAGE`
