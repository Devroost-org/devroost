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
  - Runtime: `${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`
  - Port: `4321`
  - Purpose: Astro dev server with HMR

## Route

- App: `https://astro.devroost.local`

## Image overrides

- `NODE_IMAGE`

## File permissions

The container runs directly as the host UID:GID with `userns: keep-id` so `npm install` and Astro's generated files keep host-aligned ownership on Linux rootless Podman.
