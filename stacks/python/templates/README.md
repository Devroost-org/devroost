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
`${PYTHON_IMAGE:-ghcr.io/devroost-org/devroost-python-3.12@sha256:884a0f59134fbdb22320961af5568f4f2664e38b18d445a7d72000d905338fba}`. Change `PYTHON_IMAGE`
in `.env` to make an explicit runtime override without editing `devroost.yaml`. Use
`python-django`, `python-flask`, or `python-fastapi` when starting one of those
frameworks.
