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
`${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5b3b1780892e2701df00b8f37d9a7e49c910992b58bffed95ccfb7ba58875402}`. Change `NODE_IMAGE` in
`.env` to make an explicit runtime override without editing `devroost.yaml`.
