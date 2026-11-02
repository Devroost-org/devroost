#!/usr/bin/env bash
set -euo pipefail

image_reference="${1:?usage: contract.sh <image-reference>}"
test_directory="$(mktemp -d)"
container_name="devroost-python-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${test_directory}"
}
trap cleanup EXIT

podman run --rm "${image_reference}" python3 --version \
  | grep -Eq '^Python 3\.12\.'
podman run --rm "${image_reference}" python3 -m pip --version >/dev/null
podman run --rm "${image_reference}" sh -c \
  'command -v cc >/dev/null && command -v git >/dev/null && pkg-config --exists libpq'

podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" \
  sh -c 'python3 -m venv .venv && .venv/bin/python -m pip install packaging==25.0 >/dev/null && .venv/bin/python -c "import packaging; assert packaging.__version__ == \"25.0\""'

printf '%s\n' \
  'from http.server import BaseHTTPRequestHandler, HTTPServer' \
  'class Handler(BaseHTTPRequestHandler):' \
  '    def do_GET(self):' \
  '        self.send_response(200)' \
  '        self.end_headers()' \
  '        self.wfile.write(b"devroost-python-ready")' \
  '    def log_message(self, *_args):' \
  '        pass' \
  'HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()' \
  >"${test_directory}/server.py"

podman run --detach --name "${container_name}" \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" python3 server.py >/dev/null

ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(podman exec "${container_name}" python3 -c \
    'from urllib.request import urlopen; print(urlopen("http://127.0.0.1:8000").read().decode())' \
    2>/dev/null)" == "devroost-python-ready" ]]; then
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
  python3 -c 'from pathlib import Path; Path("contract-owned.txt").write_text("ok")'

actual_owner="$(stat -c '%u:%g' "${test_directory}/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
