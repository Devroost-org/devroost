#!/usr/bin/env bash
set -euo pipefail

image_reference="${1:?usage: contract.sh <image-reference>}"
test_directory="$(mktemp -d)"
container_name="loom-bun-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${test_directory}"
}
trap cleanup EXIT

podman run --rm "${image_reference}" bun --version | grep -qx '1\.4\.4'
gnutls_version="$(podman run --rm "${image_reference}" \
  dpkg-query --show --showformat='${Version}' libgnutls30)"
if ! podman run --rm "${image_reference}" dpkg --compare-versions \
  "${gnutls_version}" ge '3.7.9-2+deb12u7'; then
  printf 'Expected libgnutls30 3.7.9-2+deb12u7 or newer, got %s\n' \
    "${gnutls_version}" >&2
  exit 1
fi
podman run --rm "${image_reference}" sh -c \
  'command -v cc >/dev/null && command -v git >/dev/null && command -v python3 >/dev/null'

mkdir -p "${test_directory}/dependency" "${test_directory}/app"
printf '%s\n' \
  '{"name":"loom-contract-dependency","version":"1.0.0","module":"index.ts","type":"module"}' \
  >"${test_directory}/dependency/package.json"
printf '%s\n' 'export const ready: string = "loom-bun-ready";' \
  >"${test_directory}/dependency/index.ts"
printf '%s\n' \
  '{"name":"loom-contract-app","version":"1.0.0","private":true,"type":"module","dependencies":{"loom-contract-dependency":"file:../dependency"}}' \
  >"${test_directory}/app/package.json"
printf '%s\n' \
  'import { ready } from "loom-contract-dependency";' \
  'if (ready !== "loom-bun-ready") process.exit(1);' \
  >"${test_directory}/app/contract.ts"

podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract/app \
  "${image_reference}" bun install --ignore-scripts >/dev/null
podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract/app \
  "${image_reference}" bun run contract.ts

printf '%s\n' \
  'Bun.serve({' \
  '  port: 3000,' \
  '  fetch() {' \
  '    return new Response("loom-bun-ready");' \
  '  },' \
  '});' \
  >"${test_directory}/server.ts"

podman run --detach --name "${container_name}" \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" bun run server.ts >/dev/null

ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(podman exec "${container_name}" bun --eval \
    'process.stdout.write(await (await fetch("http://127.0.0.1:3000")).text())' \
    2>/dev/null)" == "loom-bun-ready" ]]; then
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
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract "${image_reference}" \
  bun --eval 'await Bun.write("contract-owned.txt", "ok")'

actual_owner="$(stat -c '%u:%g' "${test_directory}/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
