# Django + React Template

This template gives you a small full-stack project with:

- Django backend service
- React frontend served by Vite
- Local source mounts for both services
- HTTPS route at `https://django-react.devroost.local`

## Services

- `backend`
  - Runtime: `${PYTHON_IMAGE:-ghcr.io/devroost-org/devroost-python-3.12@sha256:b67c733c69e09facfac79cf75702382543ffc43c3f43354887a9ade847d717eb}`
  - Working directory: `/workspace/backend`
  - Port: `8001`
  - Starts Django with `python manage.py runserver 0.0.0.0:8001`

- `web`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5b3b1780892e2701df00b8f37d9a7e49c910992b58bffed95ccfb7ba58875402}`
  - Working directory: `/workspace/frontend`
  - Port: `5176`
  - Starts Vite with `npm run dev -- --host 0.0.0.0 --port 5176`

## Route

- Frontend: `https://django-react.devroost.local`
- Backend health: `http://127.0.0.1:8001/health`
- Backend API through frontend proxy: `/api/health`, `/api/todos`

## Project layout

- `backend/` — Django app and settings
- `frontend/` — React app with Vite dev server
- `devroost.yaml` — Devroost service and route definition
- `.env.example` — runtime image defaults

## Quickstart

```bash
devroost init django-react --dir my-django-react
cd my-django-react
devroost start
devroost status
```

The backend and frontend both run directly as the host-aligned UID:GID under `userns: keep-id`. This template avoids privileged bootstrap work, so startup stays lighter while still keeping `pip`, migrations, `npm install`, and `devroost exec` aligned with the host user on Linux rootless Podman.

## Image overrides

`devroost init` copies `.env.example` to `.env`, so you can switch runtime versions without editing `devroost.yaml`.

```bash
# Python runtime
PYTHON_IMAGE=ghcr.io/devroost-org/devroost-python-3.12@sha256:b67c733c69e09facfac79cf75702382543ffc43c3f43354887a9ade847d717eb

# Node runtime
NODE_IMAGE=ghcr.io/devroost-org/devroost-node-24@sha256:5b3b1780892e2701df00b8f37d9a7e49c910992b58bffed95ccfb7ba58875402
```

You can also choose these during init interactively or pass them directly:

```bash
devroost init django-react --image PYTHON_IMAGE=ghcr.io/devroost-org/devroost-python-3.12@sha256:b67c733c69e09facfac79cf75702382543ffc43c3f43354887a9ade847d717eb --image NODE_IMAGE=ghcr.io/devroost-org/devroost-node-24@sha256:5b3b1780892e2701df00b8f37d9a7e49c910992b58bffed95ccfb7ba58875402
```
