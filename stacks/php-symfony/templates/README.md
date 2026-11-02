# Symfony Template

This template gives you a Symfony application served by Apache with PHP from local project files.

## Quickstart

```bash
devroost init php-symfony --dir my-symfony
cd my-symfony
devroost start
devroost status
```

`devroost init php-symfony` now bootstraps a real Symfony project into an empty directory with a one-shot Podman Composer container. If the target already contains an existing Symfony project, Devroost skips bootstrap and only adds or updates the Devroost files.

## Services

- `app`
  - Runtime: `${PHP_IMAGE:-ghcr.io/devroost-org/devroost-php@sha256:d9f67c2ee13bdc0f17cb836c435acb5787062311ac1843aa3ee4cb7ff11c799d}`
  - Port: `8092`
  - Purpose: Apache + PHP application server serving Symfony from `/app/public`

## Route

- App: `https://symfony.devroost.local`

## Image overrides

- `PHP_IMAGE`
