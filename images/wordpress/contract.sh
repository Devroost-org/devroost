#!/usr/bin/env bash
set -euo pipefail

trap 'status=$?; printf "WordPress contract failed at line %s: %s\n" "${LINENO}" "${BASH_COMMAND}" >&2; exit "${status}"' ERR

image_reference="${1:?usage: contract.sh <image-reference>}"
contract_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_directory="$(mktemp -d)"
container_name="devroost-wordpress-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  podman unshare rm -rf -- "${test_directory}"
}
trap cleanup EXIT

podman run --rm "${image_reference}" php -r \
  'exit(PHP_MAJOR_VERSION === 8 && PHP_MINOR_VERSION === 4 ? 0 : 1);'
podman run --rm "${image_reference}" composer --version >/dev/null
podman run --rm "${image_reference}" php -r \
  'exit(xdebug_info("mode") === [] ? 0 : 1);'
podman run --rm "${image_reference}" grep -Fq \
  '$wp_version = '\''6.8.3'\''' /usr/src/wordpress/wp-includes/version.php

podman run --rm "${image_reference}" php -m \
  | tr '[:upper:]' '[:lower:]' \
  | sed '/^\[/d; /^$/d' \
  | sort -u >"${test_directory}/actual-extensions.txt"
missing_extensions="$(comm -23 \
  "${contract_directory}/../php/extensions.txt" \
  "${test_directory}/actual-extensions.txt")"
if [[ -n "${missing_extensions}" ]]; then
  printf 'Missing required PHP extensions:\n%s\n' "${missing_extensions}" >&2
  exit 1
fi

assert_wordpress_starts() {
  local document_root="$1"
  local mount_target="$2"
  local project_directory="$3"
  mkdir -p "${project_directory}"

  podman run --detach --name "${container_name}" \
    --env "DEVROOST_DOCUMENT_ROOT=${document_root}" \
    --volume "${project_directory}:${mount_target}:Z" \
    "${image_reference}" >/dev/null

  local ready=0
  for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    if podman exec "${container_name}" test -f "${document_root}/index.php"; then
      response="$(podman exec "${container_name}" php -r \
        'echo @file_get_contents("http://127.0.0.1/");' 2>/dev/null || true)"
      if [[ "${response}" == *WordPress* || \
            "${response}" == *"Error establishing a database connection"* ]]; then
        ready=1
        break
      fi
    fi
    sleep 1
  done
  if [[ "${ready}" -ne 1 ]]; then
    podman logs "${container_name}" >&2
    exit 1
  fi
  podman rm --force "${container_name}" >/dev/null
}

assert_wordpress_starts \
  /var/www/html /var/www/html "${test_directory}/default-root"
assert_wordpress_starts \
  /workspace/public /workspace "${test_directory}/custom-root"

host_uid="$(id -u)"
host_gid="$(id -g)"
podman run --rm --user "${host_uid}:${host_gid}" --userns keep-id \
  --volume "${test_directory}/custom-root:/workspace:Z" \
  --workdir /workspace "${image_reference}" \
  php -r 'file_put_contents("contract-owned.txt", "ok");'

actual_owner="$(stat -c '%u:%g' \
  "${test_directory}/custom-root/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
