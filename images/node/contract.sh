#!/usr/bin/env bash
set -euo pipefail

trap 'status=$?; printf "Node contract failed at line %s: %s\n" "${LINENO}" "${BASH_COMMAND}" >&2; exit "${status}"' ERR

image_reference="${1:?usage: contract.sh <image-reference>}"
test_directory="$(mktemp -d)"
container_name="devroost-node-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${test_directory}"
}
trap cleanup EXIT

node_major="$(podman run --rm "${image_reference}" node --print \
  'process.versions.node.split(".")[0]')"
case "${node_major}" in
  22|24) ;;
  *)
    printf 'Expected Node 22 or 24, got %s\n' "${node_major}" >&2
    exit 1
    ;;
esac

npm_version="$(podman run --rm "${image_reference}" npm --version)"
if [[ "${npm_version}" != "11.19.1" ]]; then
  printf 'Expected npm 11.19.1, got %s\n' "${npm_version}" >&2
  exit 1
fi
npm_tar_version="$(podman run --rm "${image_reference}" node --print \
  'require("/usr/local/lib/node_modules/npm/node_modules/tar/package.json").version')"
if [[ "${npm_tar_version}" != "7.5.22" ]]; then
  printf 'Expected npm tar 7.5.22, got %s\n' "${npm_tar_version}" >&2
  exit 1
fi
pnpm_version="$(podman run --rm "${image_reference}" pnpm --version)"
if [[ "${pnpm_version}" != "10.34.5" ]]; then
  printf 'Expected pnpm 10.34.5, got %s\n' "${pnpm_version}" >&2
  exit 1
fi
pnpm_tar_version="$(podman run --rm "${image_reference}" node --print \
  'require("/root/.cache/node/corepack/v1/pnpm/10.34.5/dist/node_modules/tar/package.json").version')"
if [[ "${pnpm_tar_version}" != "7.5.19" ]]; then
  printf 'Expected pnpm tar 7.5.19, got %s\n' "${pnpm_tar_version}" >&2
  exit 1
fi
yarn_version="$(podman run --rm "${image_reference}" yarn --version)"
if [[ "${yarn_version}" != "4.9.2" ]]; then
  printf 'Expected Yarn 4.9.2, got %s\n' "${yarn_version}" >&2
  exit 1
fi

mkdir -p "${test_directory}/dependency"
printf '%s\n' \
  '{"name":"devroost-contract-dependency","version":"1.0.0","main":"index.js"}' \
  >"${test_directory}/dependency/package.json"
printf '%s\n' 'module.exports = "devroost-node-ready";' \
  >"${test_directory}/dependency/index.js"

for package_manager in npm pnpm yarn; do
  project_directory="${test_directory}/${package_manager}"
  mkdir -p "${project_directory}"
  printf '%s\n' \
    '{"name":"devroost-contract-app","version":"1.0.0","private":true,"dependencies":{"devroost-contract-dependency":"file:../dependency"}}' \
    >"${project_directory}/package.json"

  install_arguments=(install --ignore-scripts)
  package_manager_environment=()
  if [[ "${package_manager}" == "yarn" ]]; then
    install_arguments=(install --mode=skip-build)
    package_manager_environment=(--env YARN_ENABLE_GLOBAL_CACHE=false)
  fi

  podman run --rm \
    "${package_manager_environment[@]}" \
    --volume "${test_directory}:/contract:Z" \
    --workdir "/contract/${package_manager}" \
    "${image_reference}" "${package_manager}" "${install_arguments[@]}"

  runtime_command=(node)
  if [[ "${package_manager}" == "yarn" ]]; then
    runtime_command=(yarn node)
  fi

  podman run --rm \
    "${package_manager_environment[@]}" \
    --volume "${test_directory}:/contract:Z" \
    --workdir "/contract/${package_manager}" \
    "${image_reference}" "${runtime_command[@]}" --eval \
    'if (require("devroost-contract-dependency") !== "devroost-node-ready") process.exit(1);'
done

printf '%s\n' \
  'require("http").createServer((_request, response) => response.end("devroost-node-ready")).listen(3000);' \
  >"${test_directory}/server.js"
podman run --detach --name "${container_name}" \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" node server.js >/dev/null

ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(podman exec "${container_name}" node --input-type=module --eval \
    'process.stdout.write(await (await fetch("http://127.0.0.1:3000")).text())' \
    2>/dev/null)" == "devroost-node-ready" ]]; then
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
  node --eval 'require("fs").writeFileSync("contract-owned.txt", "ok")'

actual_owner="$(stat -c '%u:%g' "${test_directory}/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
