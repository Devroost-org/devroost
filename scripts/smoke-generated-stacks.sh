#!/usr/bin/env sh
set -eu

DEVROOST_BIN="${DEVROOST_BIN:-devroost}"
KEEP_WORK_ROOT="${DEVROOST_GENERATED_SMOKE_KEEP:-0}"
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
  else
    node "$DEVROOST_BIN_NODE_ENTRY" "$@" </dev/null
  fi
}

resolve_devroost_bin() {
  local_cli_entry="$REPO_ROOT/apps/cli/dist/index.js"
  if [ -f "$local_cli_entry" ]; then
    DEVROOST_BIN_NODE_ENTRY="$local_cli_entry"
    echo "Using local Devroost CLI build at $DEVROOST_BIN_NODE_ENTRY"
  elif command -v "$DEVROOST_BIN" >/dev/null 2>&1; then
    DEVROOST_BIN_PATH="$(command -v "$DEVROOST_BIN")"
  else
    echo "Missing required command: $DEVROOST_BIN" >&2
    echo "Build the local CLI first with: pnpm --dir apps/cli build" >&2
    exit 1
  fi
}

require_command node

run_id="$(node -e 'process.stdout.write(require("node:crypto").randomUUID().replaceAll("-", ""))')"
work_root_owner="devroost-generated-smoke:$run_id"

if [ -n "${DEVROOST_GENERATED_SMOKE_DIR:-}" ]; then
  requested_work_root="$DEVROOST_GENERATED_SMOKE_DIR"
  if [ -e "$requested_work_root" ] || [ -L "$requested_work_root" ]; then
    echo "Custom smoke workspace '$requested_work_root' must not already exist; refusing to reuse it." >&2
    exit 1
  fi
  if ! mkdir -m 700 -- "$requested_work_root"; then
    echo "Unable to create custom smoke workspace '$requested_work_root'. Its parent must exist and be writable." >&2
    exit 1
  fi
  work_root="$(CDPATH= cd -- "$requested_work_root" && pwd)"
  KEEP_WORK_ROOT=1
else
  work_root="$(mktemp -d "${TMPDIR:-/tmp}/devroost-generated-smoke-XXXXXX")"
fi

work_root_marker="$work_root/.devroost-generated-smoke-owner"
created_projects_file="$work_root/.devroost-generated-smoke-projects"
printf '%s\n' "$work_root_owner" > "$work_root_marker"
: > "$created_projects_file"
chmod 600 "$work_root_marker" "$created_projects_file"
smoke_token="$run_id"

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
  set_env_value "$1/.env" HOST_UID "$uid"
  set_env_value "$1/.env" HOST_GID "$gid"
}

project_name() {
  node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(value.renderInputs.projectName);' "$1/.devroost/manifest.json"
}

scoped_containers() {
  podman ps -a --filter "name=^$1-" --format '{{.Names}}' 2>/dev/null || true
}

running_scoped_containers() {
  podman ps --filter "name=^$1-" --format '{{.Names}}' 2>/dev/null || true
}

remove_scoped_containers() {
  remaining="$(scoped_containers "$1")"
  if [ -n "$remaining" ]; then
    while IFS= read -r container; do
      [ -n "$container" ] && podman rm -f "$container" >/dev/null 2>&1 || true
    done <<EOF
$remaining
EOF
  fi
}

valid_project_scope() {
  value="$1"
  [ -n "$value" ] && case "$value" in
    *[!A-Za-z0-9_-]*) return 1 ;;
    *) return 0 ;;
  esac
}

record_created_project() {
  project_key="$1"
  name="$2"
  project_dir="$3"
  if ! valid_project_scope "$project_key" || ! valid_project_scope "$name"; then
    echo "Unsafe generated smoke project scope: '$project_key' / '$name'" >&2
    return 1
  fi
  project_owner_marker="$project_dir/.devroost/generated-smoke-owner"
  printf '%s\n' "$work_root_owner" > "$project_owner_marker"
  chmod 600 "$project_owner_marker"
  printf '%s\t%s\n' "$project_key" "$name" >> "$created_projects_file"
}

owns_work_root() {
  [ -f "$work_root_marker" ] && [ -f "$created_projects_file" ] &&
    [ "$(sed -n '1p' "$work_root_marker")" = "$work_root_owner" ]
}

stop_project() {
  project_dir="$1"
  [ -d "$project_dir" ] || return 0
  (
    cd "$project_dir"
    run_devroost stop
  )
}

force_cleanup_project() {
  project_dir="$1"
  name="$2"
  [ -d "$project_dir" ] || return 0
  project_owner_marker="$project_dir/.devroost/generated-smoke-owner"
  if [ ! -f "$project_owner_marker" ] || [ "$(sed -n '1p' "$project_owner_marker")" != "$work_root_owner" ]; then
    echo "Skipping unowned smoke project during cleanup: $project_dir" >&2
    return 0
  fi
  stop_project "$project_dir" >/dev/null 2>&1 || true
  remove_scoped_containers "$name"
}

cleanup() {
  if ! owns_work_root; then
    echo "Preserving smoke workspace because its ownership marker is missing or changed: $work_root" >&2
    return 0
  fi

  tab="$(printf '\t')"
  while IFS="$tab" read -r project_key name; do
    if valid_project_scope "$project_key" && valid_project_scope "$name"; then
      force_cleanup_project "$work_root/$project_key" "$name"
    else
      echo "Skipping unsafe smoke cleanup scope: '$project_key' / '$name'" >&2
    fi
  done < "$created_projects_file"

  if [ "$KEEP_WORK_ROOT" = "0" ]; then
    if ! rm -rf "$work_root" 2>/dev/null; then
      podman unshare rm -rf "$work_root" 2>/dev/null || true
    fi
  else
    echo "Preserved generated-stack smoke workspace: $work_root"
  fi
}
trap cleanup EXIT

require_command podman
require_command perl
resolve_devroost_bin

uid="$(id -u)"
gid="$(id -g)"

developer_digest() {
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const root = process.argv[1];
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".devroost", "manifest.json"), "utf8"));
    const owned = new Set([...Object.keys(manifest.ownedFiles), ".env"]);
    const generated = new Set([".angular", ".git", ".devroost", ".next", ".pnpm-store", ".pytest_cache", ".turbo", ".venv", "__pycache__", "bin", "build", "data", "dist", "node_modules", "obj", "target", "tmp", "vendor"]);
    const hash = crypto.createHash("sha256");
    function visit(directory, relative = "") {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!generated.has(entry.name)) visit(path.join(directory, entry.name), nextRelative);
        } else if (entry.isFile() && !owned.has(nextRelative)) {
          hash.update(nextRelative).update("\0").update(fs.readFileSync(path.join(directory, entry.name)));
        }
      }
    }
    visit(root);
    process.stdout.write(hash.digest("hex"));
  ' "$1"
}

verify_manifest_hashes() {
  node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const root = process.argv[1];
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".devroost", "manifest.json"), "utf8"));
    for (const [relative, entry] of Object.entries(manifest.ownedFiles)) {
      const bytes = fs.readFileSync(path.join(root, relative));
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      if (digest !== entry.sha256) throw new Error(`${relative}: manifest hash mismatch`);
      if (!fs.readFileSync(path.join(root, entry.baselinePath)).equals(bytes)) throw new Error(`${relative}: baseline mismatch`);
    }
  ' "$1"
}

assert_owner() {
  path="$1"
  actual="$(node -e 'const fs=require("node:fs"); const value=fs.statSync(process.argv[1]); process.stdout.write(`${value.uid}:${value.gid}`);' "$path")"
  if [ "$actual" != "$uid:$gid" ]; then
    echo "Ownership mismatch for $path: expected $uid:$gid, got $actual" >&2
    return 1
  fi
}

assert_writable() {
  path="$1"
  if [ ! -f "$path" ] || [ ! -w "$path" ]; then
    echo "Expected a host-writable file at $path" >&2
    return 1
  fi
}

init_stack() {
  stack_id="$1"
  project_dir="$2"
  if [ "$stack_id" = "php-wordpress" ]; then
    run_devroost init "$stack_id" --dir "$project_dir" --db mysql
  else
    run_devroost init "$stack_id" --dir "$project_dir"
  fi
}

published_image_preflight() {
  project_dir="$1"
  [ "${DEVROOST_PUBLISHED_IMAGE_PREFLIGHT:-0}" = "1" ] || return 0
  image_references="$(node -e '
    const fs = require("node:fs");
    const yaml = fs.readFileSync(process.argv[1], "utf8");
    const references = [...yaml.matchAll(/image:\s*\$\{[A-Z][A-Z0-9_]*:?-([^}]+)\}/g)].map((match) => match[1]);
    process.stdout.write([...new Set(references)].join("\n"));
  ' "$project_dir/devroost.yaml")"
  [ -n "$image_references" ] || {
    echo "Generated project has no default image references: $project_dir/devroost.yaml" >&2
    return 1
  }
  while IFS= read -r image_reference; do
    if ! printf '%s\n' "$image_reference" | grep -Eq '^ghcr\.io/devroost-org/[^@]+@sha256:[a-f0-9]{64}$'; then
      echo "Generated project image is not an immutable Devroost GHCR reference: $image_reference" >&2
      return 1
    fi
    podman pull "$image_reference" || return 1
  done <<EOF
$image_references
EOF
}

verify_stack() {
  stack_id="$1"
  case "$stack_id" in
    node)
      run_devroost exec app -- node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || return 1
      run_devroost exec app -- sh -c 'printf "host-owned\n" > .devroost-smoke-owned' || return 1
      assert_owner .devroost-smoke-owned || return 1
      assert_owner node_modules || return 1
      ;;
    php)
      run_devroost exec app -- php -r "exit((int)!@fsockopen('127.0.0.1', 80));" || return 1
      run_devroost exec app -- sh -c 'printf "host-owned\n" > .devroost-smoke-owned' || return 1
      assert_owner .devroost-smoke-owned || return 1
      ;;
    python)
      run_devroost exec app -- python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=2)" || return 1
      run_devroost exec app -- sh -c 'printf "host-owned\n" > .devroost-smoke-owned' || return 1
      assert_owner .devroost-smoke-owned || return 1
      ;;
    db-sqlite)
      run_devroost exec db -- sqlite3 /data/devroost.db "select 1;" || return 1
      assert_owner data/sqlite/devroost.db || return 1
      assert_writable data/sqlite/devroost.db || return 1
      ;;
    php-wordpress)
      run_devroost exec app -- php -r "exit((int)!@fsockopen('127.0.0.1', 80));" || return 1
      run_devroost exec app -- sh -c 'mkdir -p wp-content/uploads && printf "host-owned\n" > wp-content/uploads/.devroost-smoke-owned' || return 1
      assert_owner wp-content/uploads/.devroost-smoke-owned || return 1
      ;;
    *)
      echo "Unsupported representative smoke stack: $stack_id" >&2
      return 1
      ;;
  esac
}

smoke_stack() {
  stack_id="$1"
  project_key="${stack_id}-${smoke_token}"
  project_dir="$work_root/$project_key"
  echo "===== GENERATED STACK SMOKE: $stack_id ====="

  if ! init_stack "$stack_id" "$project_dir"; then
    echo "===== FAIL: $stack_id (init) =====" >&2
    return 1
  fi

  name="$(project_name "$project_dir")"
  if ! record_created_project "$project_key" "$name" "$project_dir"; then
    echo "===== FAIL: $stack_id (scope) =====" >&2
    return 1
  fi

  if ! published_image_preflight "$project_dir"; then
    echo "===== FAIL: $stack_id (published image preflight) =====" >&2
    return 1
  fi

  if ! (
    cd "$project_dir"
    configure_host_ids "$project_dir" || exit 1
    assert_owner devroost.yaml || exit 1
    before="$(developer_digest "$project_dir")"
    run_devroost start --recreate || exit 1
    run_devroost status || exit 1
    verify_manifest_hashes "$project_dir" || exit 1
    after="$(developer_digest "$project_dir")"
    [ "$before" = "$after" ] || {
      echo "Developer-owned file hash changed during lifecycle for $stack_id" >&2
      exit 1
    }
    verify_stack "$stack_id" || exit 1
  ); then
    echo "===== FAIL: $stack_id (lifecycle) =====" >&2
    return 1
  fi

  if ! stop_project "$project_dir"; then
    echo "===== FAIL: $stack_id (stop) =====" >&2
    return 1
  fi
  running="$(running_scoped_containers "$name")"
  if [ -n "$running" ]; then
    echo "Running scoped containers remain after stop for $stack_id:" >&2
    echo "$running" >&2
    return 1
  fi
  remove_scoped_containers "$name"
  remaining="$(scoped_containers "$name")"
  [ -z "$remaining" ] || {
    echo "Scoped smoke cleanup left containers for $stack_id: $remaining" >&2
    return 1
  }

  echo "===== PASS: $stack_id ====="
  echo
}

if [ "$#" -gt 0 ]; then
  stack_ids="$*"
else
  stack_ids="node php python db-sqlite php-wordpress"
fi

pass=0
fail=0
for stack_id in $stack_ids; do
  if smoke_stack "$stack_id"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    KEEP_WORK_ROOT=1
  fi
done

echo "RESULT: pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
