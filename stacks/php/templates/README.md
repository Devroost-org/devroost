# PHP starter

This project was generated from Devroost's versioned `php` stack package. It runs
Apache with PHP and serves the selected document root from the host project.

```bash
devroost start
devroost status
devroost exec app -- php -v
devroost stop
```

Pass `--php-docroot <path>` to `devroost init php` when the application entrypoint
is not the project root. The generated `.env` exposes the exact default PHP
image tag and may be edited for an explicit runtime override:

- `${PHP_IMAGE:-ghcr.io/devroost-org/devroost-php@sha256:3ca4a5a3832c205dacfbe05b44a8693c4c8283f773ec48f0d82a7930d3ebcff9}`
