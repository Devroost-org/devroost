# MEAN Template

This template includes MongoDB, an Express.js API, a modern Angular frontend, and the Node.js runtime.

## Quickstart

```bash
devroost init node-mean --dir my-mean
cd my-mean
devroost start
devroost status
```

## Services

- `mongo`
  - Port: `27021`
- `api`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`
  - Port: `3001`
  - Purpose: Express.js API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`
  - Port: `4200`
  - Purpose: Angular frontend served by Angular CLI with `/api` proxying to the backend

## Route

- Frontend: `https://mean.devroost.local`

## Image overrides

- `NODE_IMAGE`
