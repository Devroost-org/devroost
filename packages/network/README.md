# @devroost/network

Route and proxy networking utilities for Devroost.

- Route binding resolution
- Proxy container orchestration
- Service network helpers

The shared `devroost-proxy` container uses `~/.devroost/network` for route snippets and
project-specific certificates. Starting a project attaches its Podman network and
reloads the proxy. Stopping a project removes only its routes. The first start
after upgrading replaces the old proxy that mounted a single project's files;
start each project again to register its routes in the shared state directory.
