# Spring + React Template

This template combines a Spring Boot backend with a React frontend for a classic full-stack split application, with the frontend calling the backend through a local `/api` proxy.

## Quickstart

```bash
devroost init spring-react --dir my-spring-react
cd my-spring-react
devroost start
devroost status
```

## Services

- `backend`
  - Runtime: `${JAVA_IMAGE:-ghcr.io/loom-development/loom-java-21@sha256:dd2c87a716b9f86d94cacc5db4b7b44ec3ba864f33ca3d6823461f84522dbe7e}`
  - Port: `8081`
  - Purpose: Spring Boot API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/loom-development/loom-node-22@sha256:25823da1bec192be0882fa20a0838f576e2b6cc7e7aefbb1183ebc3cf1c924e6}`
  - Port: `5175`
  - Purpose: built React frontend served locally with `/api` proxied to Spring Boot

## Endpoints

- Frontend: `GET /`
- Backend: `GET /api/health`
- Backend: `GET /api/hello`

## Route

- Frontend: `https://spring-react.devroost.local`

## Image overrides

- `JAVA_IMAGE`
- `NODE_IMAGE`

## File permissions

This template keeps the existing `userns: keep-id` startup model because it does not need privileged package installation during `devroost start`, but `devroost exec` and task runs now use a host-aligned UID:GID by default through `execUser`. That keeps ad-hoc writes under the bind-mounted project tree aligned with the host user on Linux rootless Podman.

The backend exposes JSON endpoints and the frontend renders live data from Spring Boot instead of showing a static placeholder. Devroost serves the built React app through a small local Node server, which is more stable in-container than running the Vite dev server directly.
