# Astro Template

This template gives you an Astro site running on Node.js, served from local project files.

## Quickstart

```bash
devroost init astro --dir my-site
cd my-site
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:47887d26da9d5e31892f351297e03004ffd61f2d5c443ca4e56d89768e365f5c}`
  - Port: `4321`
  - Purpose: Astro dev server with HMR

## Route

- App: `https://astro.devroost.local`

## Image overrides

- `NODE_IMAGE`

## File permissions

The container runs directly as the host UID:GID with `userns: keep-id` so `npm install` and Astro's generated files keep host-aligned ownership on Linux rootless Podman.
