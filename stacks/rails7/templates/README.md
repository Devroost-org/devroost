# Rails 7 Template

This template gives you a Rails 7 application served from local project files. The container image is plain Ruby; Rails 7 is bootstrapped into the project and then loaded from the app's Gemfile.

## Quickstart

```bash
devroost init rails7 --dir my-rails7
cd my-rails7
devroost start
devroost status
```

`devroost init rails7` bootstraps the app into an empty directory, or adopts an existing Rails project and only adds Devroost files. Devroost runs the generated app with a Ruby base image, not a separate Rails image.

The first `devroost start` can take a while because the container installs native build dependencies and runs `bundle install` before Rails starts serving requests. Linux with rootless Podman gives Devroost the most reliable host-aligned file ownership when templates use `userns: keep-id`. On macOS and Windows, Devroost still works through Podman machine and `devroost exec` still uses the configured `execUser`, but bind-mounted filesystem ownership behavior and install speed can differ from native Linux.

## Services

- `app`
  - Base image: `${RUBY_IMAGE:-ghcr.io/loom-development/loom-ruby-3.3@sha256:fa3ff65b942751619cecc93a2fbecd23aee0c03400d99390c0be4242938e99e1}`
  - Port: `3006`
  - Purpose: Ruby container running the bootstrapped Rails 7 app

## Route

- App: `https://rails7.devroost.local`

## Image overrides

- `RUBY_IMAGE` for the Ruby base image used to run the Rails app
