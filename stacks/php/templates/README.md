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

- `${PHP_IMAGE:-ghcr.io/devroost-org/devroost-php@sha256:d9f67c2ee13bdc0f17cb836c435acb5787062311ac1843aa3ee4cb7ff11c799d}`
