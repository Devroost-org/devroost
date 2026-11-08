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
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:47887d26da9d5e31892f351297e03004ffd61f2d5c443ca4e56d89768e365f5c}`
  - Port: `3001`
  - Purpose: Express.js API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:47887d26da9d5e31892f351297e03004ffd61f2d5c443ca4e56d89768e365f5c}`
  - Port: `4200`
  - Purpose: Angular frontend served by Angular CLI with `/api` proxying to the backend

## Route

- Frontend: `https://mean.devroost.local`

## Image overrides

- `NODE_IMAGE`
