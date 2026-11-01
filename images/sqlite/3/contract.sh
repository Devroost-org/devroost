#!/usr/bin/env bash
set -Eeuo pipefail

trap 'status=$?; printf "SQLite contract failed at line %s: %s\n" "${LINENO}" "${BASH_COMMAND}" >&2; exit "${status}"' ERR

image_reference="${1:?usage: contract.sh <image-reference>}"
test_directory="$(mktemp -d)"

cleanup() {
  rm -rf "${test_directory}"
}
trap cleanup EXIT

podman run --rm "${image_reference}" sqlite3 --version \
  | { version=$(cat); printf '%s\n' "$version" >&2; printf '%s\n' "$version"; } | grep -Eq '^3\.54\.1 '

database_path="${test_directory}/loom.sqlite3"
podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  "${image_reference}" sqlite3 /contract/loom.sqlite3 \
  "CREATE TABLE status (value TEXT NOT NULL); INSERT INTO status VALUES ('loom-sqlite-ready');"

if [[ "$(podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  "${image_reference}" sqlite3 /contract/loom.sqlite3 \
  'SELECT value FROM status;')" != "loom-sqlite-ready" ]]; then
  printf 'Persisted SQLite database did not return expected value\n' >&2
  exit 1
fi

if [[ "$(podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  "${image_reference}" sqlite3 /contract/loom.sqlite3 \
  'PRAGMA journal_mode=WAL;')" != "wal" ]]; then
  printf 'SQLite database did not enable WAL journal mode\n' >&2
  exit 1
fi

host_uid="$(id -u)"
host_gid="$(id -g)"
rm "${database_path}"
podman run --rm --user "${host_uid}:${host_gid}" --userns keep-id \
  --volume "${test_directory}:/contract:Z" \
  "${image_reference}" sqlite3 /contract/loom.sqlite3 \
  'CREATE TABLE ownership (value TEXT NOT NULL);'

actual_owner="$(stat -c '%u:%g' "${database_path}")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned database %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
