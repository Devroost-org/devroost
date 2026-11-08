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
  - Runtime: `${JAVA_IMAGE:-ghcr.io/devroost-org/devroost-java-21@sha256:576bb2470a390e3f1aa1f751a3a6dd586c619050032084beffad52a48c46a97e}`
  - Port: `8081`
  - Purpose: Spring Boot API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-22@sha256:d619f341b065fc1bf6c0e3b793847f202fad1478c37b54c0f11aed1b55ca798b}`
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
