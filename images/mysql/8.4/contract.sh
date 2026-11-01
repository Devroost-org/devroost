#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; printf "MySQL contract failed at line %s: %s\n" "${LINENO}" "${BASH_COMMAND}" >&2; exit "${status}"' ERR
image_reference="${1:?usage: contract.sh <image-reference>}"
podman run --rm "${image_reference}" mysqld --version | grep '8\.4\.13'
podman run --rm "${image_reference}" /usr/lib/mysqlsh/bin/python3.13 -c \
  'import certifi; from importlib.metadata import version; assert version("certifi") == "2026.10.19"; print(certifi.where())'
node "$(dirname "${BASH_SOURCE[0]}")/../../../scripts/images/test-mirror.mjs" \
  mysql-8.4 "${image_reference}"
