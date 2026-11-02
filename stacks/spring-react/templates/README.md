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
  - Runtime: `${JAVA_IMAGE:-ghcr.io/devroost-org/devroost-java-21@sha256:8f86e4e6ba93af301147df6e2ac3251804cc7999657f5fc1dc6437dfe5003874}`
  - Port: `8081`
  - Purpose: Spring Boot API
- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-22@sha256:13afb4f007ba9a3bb53ad78052966072af0e22b925ffa018bead798304f2fc4d}`
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
