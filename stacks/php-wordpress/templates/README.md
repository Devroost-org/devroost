# WordPress Template

This template gives you a local WordPress setup with PHP, served from project files. Add a database during init with `--db mysql`.

## Quickstart

```bash
devroost init php-wordpress --dir my-wordpress --db mysql
cd my-wordpress
devroost start
devroost status
```

## Services

- `app`
  - Runtime: `${WORDPRESS_IMAGE:-ghcr.io/devroost-org/devroost-wordpress@sha256:56b061e053c09046384493bffe0849642856ab413890547ca4b3dd8a121e4013}`
  - Port: `8090`
  - Purpose: WordPress app server

## Route

- App: `https://wordpress.devroost.local`

## Project structure

```
my-wordpress/
├── .env              # environment variables (DB settings, HOST_UID/GID)
├── devroost.yaml         # Devroost service configuration
├── wp-config.php     # reads DB settings from environment variables
└── wp-content/       # persisted WordPress content
    ├── plugins/      # your custom plugins
    ├── themes/       # your custom themes
    └── uploads/      # media uploads
```

WordPress core files live inside the container image. Only `wp-content/` is bind-mounted from your project directory so plugins, themes, and uploads persist across restarts.

## Database

Pass `--db mysql` during init to add a MySQL database service. Devroost generates connection credentials and writes them to `.env`. `wp-config.php` reads those values at runtime via the `devroostWordPressEnv()` helper.

```bash
devroost init php-wordpress --dir my-site --db mysql
```

## Image overrides

- `WORDPRESS_IMAGE`

## File permissions

The container starts as `root` and remaps Apache's `www-data` user to `HOST_UID` and `HOST_GID` before startup so WordPress can write to the bind-mounted project files during updates.

- `HOST_UID` defaults to `1000`
- `HOST_GID` defaults to `1000`

If your Linux user uses different IDs, update those values in `.env` after `devroost init`.

## WordPress updates

This template configures WordPress with `FS_METHOD=direct` by default, so plugin, theme, and core updates use direct filesystem writes instead of prompting for FTP credentials.

Devroost also skips the Composer-on-start check for this template because WordPress does not need Composer to boot.
