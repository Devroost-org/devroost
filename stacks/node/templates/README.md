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
`${NODE_IMAGE:-ghcr.io/devroost-org/devroost-node-24@sha256:5bdb11d871f1cea2d5c20305e35d63ab199d23d9b8be69135fc615425f38420c}`. Change `NODE_IMAGE` in
`.env` to make an explicit runtime override without editing `devroost.yaml`.
