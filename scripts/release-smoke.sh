#!/usr/bin/env sh
set -eu

DEVROOST_BIN="${DEVROOST_BIN:-devroost}"
KEEP_WORK_ROOT="${DEVROOST_RELEASE_SMOKE_KEEP:-0}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

run_devroost() {
  if [ -n "${DEVROOST_BIN_PATH:-}" ]; then
    "$DEVROOST_BIN_PATH" "$@" </dev/null
    return
  fi

  if [ -n "${DEVROOST_BIN_NODE_ENTRY:-}" ]; then
    node "$DEVROOST_BIN_NODE_ENTRY" "$@" </dev/null
    return
  fi

  echo "Unable to resolve Devroost CLI executable." >&2
  exit 1
}

resolve_devroost_bin() {
  local_cli_entry="$REPO_ROOT/apps/cli/dist/index.js"
  if [ -f "$local_cli_entry" ]; then
    require_command node
    DEVROOST_BIN_NODE_ENTRY="$local_cli_entry"
    echo "Using local Devroost CLI build at $DEVROOST_BIN_NODE_ENTRY"
    return
  fi

  if command -v "$DEVROOST_BIN" >/dev/null 2>&1; then
    DEVROOST_BIN_PATH="$(command -v "$DEVROOST_BIN")"
    return
  fi

  if [ "$DEVROOST_BIN" != "devroost" ]; then
    echo "Missing required command: $DEVROOST_BIN" >&2
    exit 1
  fi

  echo "Missing required command: devroost" >&2
  echo "Build the local CLI first with: pnpm --dir apps/cli build" >&2
  exit 1
}

resolve_devroost_bin
require_command podman
require_command perl
require_command stat
require_command id
require_command grep

uid="$(id -u)"
gid="$(id -g)"

if [ -n "${DEVROOST_RELEASE_SMOKE_DIR:-}" ]; then
  work_root="$DEVROOST_RELEASE_SMOKE_DIR"
  mkdir -p "$work_root"
  KEEP_WORK_ROOT=1
else
  work_root="$(mktemp -d "${TMPDIR:-/tmp}/devroost-release-smoke-XXXXXX")"
fi

cleanup() {
  if [ "$KEEP_WORK_ROOT" = "0" ] && [ -d "$work_root" ]; then
    if rm -rf "$work_root" 2>/dev/null; then
      return 0
    fi

    if podman unshare rm -rf "$work_root" 2>/dev/null; then
      return 0
    fi

    echo "Warning: failed to remove release smoke workspace cleanly; preserved: $work_root" >&2
    return 0
  else
    echo "Preserved release smoke workspace: $work_root"
  fi
}

trap cleanup EXIT

pass=0
fail=0

stop_project() {
  project_dir="$1"
  if [ -d "$project_dir" ]; then
    (
      cd "$project_dir"
      run_devroost stop >/dev/null 2>&1 || true
    )
    project_name="$(basename "$project_dir" | tr '-' '_')"
    podman rm -f "devroost-${project_name}-proxy" 2>/dev/null || true
    sleep 2
  fi
}

assert_owner() {
  path="$1"
  expected="$2"
  actual="$(stat -c '%u:%g' "$path")"
  if [ "$actual" != "$expected" ]; then
    echo "Ownership mismatch for $path: expected $expected, got $actual" >&2
    return 1
  fi
}

set_env_value() {
  file="$1"
  key="$2"
  value="$3"

  if grep -q "^${key}=" "$file"; then
    perl -0pi -e "s/^${key}=.*$/${key}=${value}/m" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

configure_host_ids() {
  env_file="$1"
  set_env_value "$env_file" HOST_UID "$uid"
  set_env_value "$env_file" HOST_GID "$gid"
}

smoke_stack() {
  label="$1"
  template="$2"
  image_override="$3"
  shift 3
  extra_args="$*"
  project_dir="$work_root/$label"

  echo "===== RELEASE SMOKE: $label ====="

  if ! run_devroost init "$template" --dir "$project_dir" --image "$image_override" $extra_args; then
    echo "init failed for $label" >&2
    fail=$((fail + 1))
    KEEP_WORK_ROOT=1
    echo
    return
  fi

  if (
    cd "$project_dir"
    configure_host_ids .env
    run_devroost start --recreate || exit 1

    case "$label" in
      node)
        run_devroost exec app -- sh -c 'id && pwd && printf "node-write\n" > owned-by-host.txt && ls -ld node_modules' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner node_modules "$uid:$gid" || exit 1
        ;;
      python)
        run_devroost exec app -- sh -c 'id && pwd && printf "python-write\n" > owned-by-host.txt && ls -l index.html' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner index.html "$uid:$gid" || exit 1
        ;;
      rails7)
        run_devroost exec app -- sh -c 'id && pwd && mkdir -p tmp && printf "rails-write\n" > tmp/owned-by-host.txt && ls -ld tmp tmp/owned-by-host.txt' || exit 1
        assert_owner tmp/owned-by-host.txt "$uid:$gid" || exit 1
        ;;
      wordpress)
        run_devroost exec app -- sh -c 'id && pwd && mkdir -p wp-content/uploads && printf "wordpress-write\n" > wp-content/uploads/owned-by-host.txt && ls -ld wp-content/uploads wp-content/uploads/owned-by-host.txt' || exit 1
        assert_owner wp-content/uploads/owned-by-host.txt "$uid:$gid" || exit 1
        ;;
      django-react)
        run_devroost exec backend -- sh -c 'id && pwd && printf "django-react-write\n" > owned-by-host.txt && ls -l db.sqlite3' || exit 1
        assert_owner backend/owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner backend/db.sqlite3 "$uid:$gid" || exit 1
        assert_owner frontend/node_modules "$uid:$gid" || exit 1
        ;;
      python-flask)
        run_devroost exec app -- sh -c 'id && pwd && printf "flask-write\n" > owned-by-host.txt && ls -l app.py requirements.txt' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner app.py "$uid:$gid" || exit 1
        ;;
      python-fastapi)
        run_devroost exec app -- sh -c 'id && pwd && printf "fastapi-write\n" > owned-by-host.txt && ls -l app/main.py requirements.txt' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner app/main.py "$uid:$gid" || exit 1
        ;;
      php)
        run_devroost exec app -- sh -c 'id && pwd && printf "php-write\n" > owned-by-host.txt && ls -l index.php' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner index.php "$uid:$gid" || exit 1
        ;;
      dotnet)
        run_devroost exec app -- sh -c 'id && cd /workspace && printf "dotnet-write\n" > owned-by-host.txt && ls -ld src/obj src/bin src' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner src/obj "$uid:$gid" || exit 1
        ;;
      rails7-hotwire)
        run_devroost exec app -- sh -c 'id && pwd && mkdir -p tmp && printf "rails-hotwire-write\n" > tmp/owned-by-host.txt && ls -ld tmp' || exit 1
        assert_owner tmp/owned-by-host.txt "$uid:$gid" || exit 1
        ;;
      astro)
        run_devroost exec app -- sh -c 'id && pwd && printf "astro-write\n" > owned-by-host.txt && ls -ld node_modules' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner node_modules "$uid:$gid" || exit 1
        ;;
      spring-boot)
        run_devroost exec app -- sh -c 'id && pwd && printf "spring-boot-write\n" > owned-by-host.txt && ls -ld target pom.xml' || exit 1
        assert_owner owned-by-host.txt "$uid:$gid" || exit 1
        assert_owner target "$uid:$gid" || exit 1
        ;;
      *)
        echo "Unknown release smoke label: $label" >&2
        exit 1
        ;;
    esac
  ); then
    stop_project "$project_dir"
    echo "===== PASS: $label ====="
    pass=$((pass + 1))
  else
    stop_project "$project_dir"
    echo "===== FAIL: $label =====" >&2
    fail=$((fail + 1))
    KEEP_WORK_ROOT=1
  fi

  echo
}

echo "===== Checking for running Devroost proxies ====="
running_proxies="$(podman ps --filter name=-proxy --format '{{.Names}} {{.Status}}' 2>/dev/null || true)"
if [ -n "$running_proxies" ]; then
  echo "Stopping existing Devroost proxy containers before smoke tests:"
  while read -r name status; do
    echo "  - ${name} (${status})"
    podman rm -f "$name" 2>/dev/null || true
  done <<PROXIES
$running_proxies
PROXIES
  sleep 2
  echo
fi

smoke_stack node node "NODE_IMAGE=docker.io/library/node:22-alpine"
smoke_stack python python "PYTHON_IMAGE=docker.io/library/python:3.12-slim"
smoke_stack rails7 rails7 "RUBY_IMAGE=docker.io/library/ruby:3.3"
smoke_stack wordpress php-wordpress "WORDPRESS_IMAGE=docker.io/library/wordpress:6-php8.3-apache" --db mysql
smoke_stack django-react django-react "PYTHON_IMAGE=docker.io/library/python:3.12-slim"
smoke_stack python-flask python-flask "PYTHON_IMAGE=docker.io/library/python:3.12-slim"
smoke_stack python-fastapi python-fastapi "PYTHON_IMAGE=docker.io/library/python:3.12-slim"
smoke_stack php php "PHP_IMAGE=docker.io/library/php:8.4-apache"
smoke_stack dotnet dotnet "DOTNET_IMAGE=mcr.microsoft.com/dotnet/sdk:8.0"
smoke_stack rails7-hotwire rails7-hotwire "RUBY_IMAGE=docker.io/library/ruby:3.3"
smoke_stack astro astro "NODE_IMAGE=docker.io/library/node:24-alpine"
smoke_stack spring-boot spring-boot "JAVA_IMAGE=docker.io/library/maven:3.9-eclipse-temurin-21"

echo "RESULT: pass=$pass fail=$fail"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
