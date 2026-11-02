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
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5b3b1780892e2701df00b8f37d9a7e49c910992b58bffed95ccfb7ba58875402}`
  - Port: `3002`
  - Purpose: Express.js API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5b3b1780892e2701df00b8f37d9a7e49c910992b58bffed95ccfb7ba58875402}`
  - Port: `5173`
  - Purpose: React frontend

## Route

- Frontend: `https://mern.devroost.local`

## Image overrides

- `NODE_IMAGE`
