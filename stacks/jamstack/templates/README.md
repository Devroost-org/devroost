# JAMstack Template

This template models the modern JAMstack idea directly: JavaScript in the frontend, API-driven content, and markup-first pages delivered from a static-first web app.

## Quickstart

```bash
devroost init jamstack --dir my-jamstack
cd my-jamstack
devroost start
devroost status
```

## Services

- `api`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`
  - Port: `3006`
  - Purpose: JSON API for frontend content
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`
  - Port: `5174`
  - Purpose: static-first frontend served by Vite

## Route

- Frontend: `https://jamstack.devroost.local`
- API proxy: `/api/content`

## Image overrides

- `NODE_IMAGE`

After init, edit `.env` or pass `--image NODE_IMAGE=ghcr.io/devroost-org/devroost-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c` during `devroost init`.
