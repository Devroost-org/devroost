# Serverless Template

This template gives you a 2026-style serverless-inspired workflow with a FaaS backend and a static SPA frontend, without depending on the `serverless` npm package.

## Quickstart

```bash
devroost init serverless --dir my-serverless
cd my-serverless
devroost start
devroost status
```

## What changed for 2026

- Node.js 22 Lambda runtime target
- backend functions handled by a small FaaS-style router
- static SPA frontend served separately and proxied to backend functions
- webhook-style POST endpoint for event ingestion
- direct local invoke scripts for smoke checks and CI
- no `serverless` npm dependency or framework manifest in the template

## Services

- `api`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-22@sha256:13afb4f007ba9a3bb53ad78052966072af0e22b925ffa018bead798304f2fc4d}`
  - Port: `3007`
- Purpose: local FaaS-style runtime for backend functions
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-22@sha256:13afb4f007ba9a3bb53ad78052966072af0e22b925ffa018bead798304f2fc4d}`
  - Port: `3008`
  - Purpose: static SPA server with `/api/*` proxying to the backend functions

## Endpoints

- Frontend: `GET /`
- Backend: `GET /api/health`
- Backend: `GET /api/feed`
- Backend: `POST /api/webhooks/content`

## Local scripts

- `npm run dev:api`
- `npm run dev:web`
- `npm run invoke:health`
- `npm run invoke:feed`
- `npm run smoke:webhook`

## Route

- Web app: `https://serverless.devroost.local`

## Image overrides

- `NODE_IMAGE`

Use `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-22@sha256:13afb4f007ba9a3bb53ad78052966072af0e22b925ffa018bead798304f2fc4d}` by default here. The backend is modeled after AWS-style Node `nodejs22.x` functions, and Node 22 keeps local behavior aligned with that target.

The frontend is intentionally static-first. It demonstrates the common pattern where a SPA calls backend functions over HTTP while deployment stays serverless in production.
