# Node starter

This project was generated from Devroost's versioned `node` stack package. Its
application source and lockfile belong to you; Devroost owns only the paths listed
in `.devroost/manifest.json`.

```bash
devroost start
devroost status
devroost test
devroost stop
```

The app serves its health endpoint at `/health`. Its exact default runtime is
`${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:47887d26da9d5e31892f351297e03004ffd61f2d5c443ca4e56d89768e365f5c}`. Change `NODE_IMAGE` in
`.env` to make an explicit runtime override without editing `devroost.yaml`.
