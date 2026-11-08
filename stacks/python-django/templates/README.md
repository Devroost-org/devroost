# Django Template

This template gives you a minimal Django project running from local source files.

## Quickstart

```bash
devroost init python-django --dir my-django
cd my-django
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${PYTHON_IMAGE:-ghcr.io/devroost-org/devroost-python-3.12@sha256:884a0f59134fbdb22320961af5568f4f2664e38b18d445a7d72000d905338fba}`
  - Port: `8001`
  - Purpose: Django development server

## Route

- App: `https://django.devroost.local`

## Image overrides

- `PYTHON_IMAGE`
