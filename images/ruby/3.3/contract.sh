#!/usr/bin/env bash
set -euo pipefail

image_reference="${1:?usage: contract.sh <image-reference>}"
test_directory="$(mktemp -d)"
container_name="devroost-ruby-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${test_directory}"
}
trap cleanup EXIT

podman run --rm "${image_reference}" ruby --version \
  | grep -Eq '^ruby 3\.3\.'
podman run --rm "${image_reference}" bundle --version >/dev/null
podman run --rm "${image_reference}" sh -c \
  'command -v cc >/dev/null && command -v git >/dev/null && pkg-config --exists libpq'

mkdir -p "${test_directory}/dependency/lib" "${test_directory}/app"
printf '%s\n' \
  'Gem::Specification.new do |spec|' \
  '  spec.name = "devroost_contract_dependency"' \
  '  spec.version = "1.0.0"' \
  '  spec.summary = "Devroost Ruby image contract dependency"' \
  '  spec.authors = ["Devroost"]' \
  '  spec.files = ["lib/devroost_contract_dependency.rb"]' \
  '  spec.require_paths = ["lib"]' \
  'end' \
  >"${test_directory}/dependency/devroost_contract_dependency.gemspec"
printf '%s\n' 'DEVROOST_RUBY_READY = "devroost-ruby-ready"' \
  >"${test_directory}/dependency/lib/devroost_contract_dependency.rb"
printf '%s\n' \
  'source "https://rubygems.org"' \
  'gem "devroost_contract_dependency", path: "../dependency"' \
  >"${test_directory}/app/Gemfile"

podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract/app \
  "${image_reference}" bundle install --local >/dev/null
podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract/app \
  "${image_reference}" bundle exec ruby -e \
  'require "devroost_contract_dependency"; abort unless DEVROOST_RUBY_READY == "devroost-ruby-ready"'

printf '%s\n' \
  'require "socket"' \
  'server = TCPServer.new("0.0.0.0", 9292)' \
  'loop do' \
  '  client = server.accept' \
  '  client.gets' \
  '  loop do' \
  '    line = client.gets' \
  '    break if line.nil? || line == "\r\n"' \
  '  end' \
  '  body = "devroost-ruby-ready"' \
  '  client.write "HTTP/1.1 200 OK\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n#{body}"' \
  '  client.close' \
  'end' \
  >"${test_directory}/server.rb"

podman run --detach --name "${container_name}" \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" ruby server.rb >/dev/null

ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(podman exec "${container_name}" ruby -rsocket -e \
    'socket = TCPSocket.new("127.0.0.1", 9292); socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n"); print socket.read.split("\r\n\r\n", 2).last' \
    2>/dev/null)" == "devroost-ruby-ready" ]]; then
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
  ruby -e 'File.write("contract-owned.txt", "ok")'

actual_owner="$(stat -c '%u:%g' "${test_directory}/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
