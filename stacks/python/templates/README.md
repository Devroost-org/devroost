# Python starter

This project was generated from Devroost's versioned `python` stack package. Its
source remains in the host project and is bind-mounted into the runtime.

```bash
devroost start
devroost status
devroost exec app -- python --version
devroost stop
```

The exact default runtime is
`${PYTHON_IMAGE:-ghcr.io/devroost-org/devroost-python-3.12@sha256:dfc56d79d2e1ec7552b172f58bab8468929cf80dca40a33078654bc5fb8d9a94}`. Change `PYTHON_IMAGE`
in `.env` to make an explicit runtime override without editing `devroost.yaml`. Use
`python-django`, `python-flask`, or `python-fastapi` when starting one of those
frameworks.
