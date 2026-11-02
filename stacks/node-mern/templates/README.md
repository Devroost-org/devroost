# MERN Template

This template includes MongoDB, an Express.js API, a React frontend, and the Node.js runtime.

## Quickstart

```bash
devroost init node-mern --dir my-mern
cd my-mern
devroost start
devroost status
```

## Services

- `mongo`
  - Port: `27022`
- `api`
  - Runtime: `${NODE_IMAGE:-ghcr.io/loom-development/loom-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`
  - Port: `3002`
  - Purpose: Express.js API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/loom-development/loom-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`
  - Port: `5173`
  - Purpose: React frontend

## Route

- Frontend: `https://mern.devroost.local`

## Image overrides

- `NODE_IMAGE`
