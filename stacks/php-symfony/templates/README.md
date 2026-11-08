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
  - Runtime: `${PHP_IMAGE:-ghcr.io/devroost-org/devroost-php@sha256:4f09d53d6d196828b0aa0586c64959328cb6973007ea7bebef23913b94f89036}`
  - Port: `8092`
  - Purpose: Apache + PHP application server serving Symfony from `/app/public`

## Route

- App: `https://symfony.devroost.local`

## Image overrides

- `PHP_IMAGE`
