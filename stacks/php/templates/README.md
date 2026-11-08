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

- `${PHP_IMAGE:-ghcr.io/devroost-org/devroost-php@sha256:4f09d53d6d196828b0aa0586c64959328cb6973007ea7bebef23913b94f89036}`
