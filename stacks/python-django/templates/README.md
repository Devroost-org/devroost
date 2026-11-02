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
  - Runtime: `${PYTHON_IMAGE:-ghcr.io/devroost-org/devroost-python-3.12@sha256:b67c733c69e09facfac79cf75702382543ffc43c3f43354887a9ade847d717eb}`
  - Port: `8001`
  - Purpose: Django development server

## Route

- App: `https://django.devroost.local`

## Image overrides

- `PYTHON_IMAGE`
