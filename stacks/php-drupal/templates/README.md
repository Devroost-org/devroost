# Drupal Template

This template gives you a local Drupal setup served by Apache with PHP from project files. Add a database during init with `--db mysql`.

## Quickstart

```bash
devroost init php-drupal --dir my-drupal --db mysql
cd my-drupal
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${PHP_IMAGE:-ghcr.io/devroost-org/devroost-php@sha256:d9f67c2ee13bdc0f17cb836c435acb5787062311ac1843aa3ee4cb7ff11c799d}`
  - Port: `8091`
  - Purpose: Apache + PHP application server serving Drupal from `/app/web`

## Route

- App: `https://drupal.devroost.local`

## Image overrides

- `PHP_IMAGE`

## File permissions

The container starts as `root` and remaps Apache's `www-data` user to `HOST_UID` and `HOST_GID` before startup. That keeps writes under the bind-mounted project directory and `sites/default/files` aligned with the host user on Linux rootless Podman.

`devroost exec app -- ...` uses the same host-aligned UID:GID by default.
