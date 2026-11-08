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
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:47887d26da9d5e31892f351297e03004ffd61f2d5c443ca4e56d89768e365f5c}`
  - Port: `3002`
  - Purpose: Express.js API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:47887d26da9d5e31892f351297e03004ffd61f2d5c443ca4e56d89768e365f5c}`
  - Port: `5173`
  - Purpose: React frontend

## Route

- Frontend: `https://mern.devroost.local`

## Image overrides

- `NODE_IMAGE`
