#!/usr/bin/env bash
set -euo pipefail

trap 'status=$?; printf "PHP contract failed at line %s: %s\n" "${LINENO}" "${BASH_COMMAND}" >&2; exit "${status}"' ERR

image_reference="${1:?usage: contract.sh <image-reference>}"
contract_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_directory="$(mktemp -d)"
container_name="devroost-php-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${test_directory}"
}
trap cleanup EXIT

podman run --rm "${image_reference}" php -m \
  | tr '[:upper:]' '[:lower:]' \
  | sed '/^\[/d; /^$/d' \
  | sort -u >"${test_directory}/actual-extensions.txt"

missing_extensions="$(comm -23 "${contract_directory}/extensions.txt" "${test_directory}/actual-extensions.txt")"
if [[ -n "${missing_extensions}" ]]; then
  printf 'Missing required PHP extensions:\n%s\n' "${missing_extensions}" >&2
  exit 1
fi

podman run --rm "${image_reference}" composer --version >/dev/null
podman run --rm "${image_reference}" php -r \
  'exit(xdebug_info("mode") === [] ? 0 : 1);'
apache_modules="$(podman run --rm "${image_reference}" apache2ctl -M 2>/dev/null || true)"
grep -q 'rewrite_module' <<<"${apache_modules}"

mkdir -p "${test_directory}/project/public"
printf '%s\n' '<?php echo "devroost-php-ready";' \
  >"${test_directory}/project/public/index.php"

podman run --detach --name "${container_name}" \
  --env DEVROOST_DOCUMENT_ROOT=/workspace/public \
  --volume "${test_directory}/project:/workspace:Z" \
  "${image_reference}" >/dev/null

ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(podman exec "${container_name}" php -r \
    'echo @file_get_contents("http://127.0.0.1/");' 2>/dev/null)" == "devroost-php-ready" ]]; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  podman logs "${container_name}" >&2
  exit 1
fi

host_uid="$(id -u)"
host_gid="$(id -g)"
podman run --rm --user "${host_uid}:${host_gid}" --userns keep-id \
  --volume "${test_directory}/project:/workspace:Z" \
  --workdir /workspace "${image_reference}" \
  php -r 'file_put_contents("contract-owned.txt", "ok");'

actual_owner="$(stat -c '%u:%g' "${test_directory}/project/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
