#!/usr/bin/env bash
set -Eeuo pipefail

trap 'status=$?; printf ".NET contract failed at line %s: %s\n" "${LINENO}" "${BASH_COMMAND}" >&2; exit "${status}"' ERR

image_reference="${1:?usage: contract.sh <image-reference>}"
test_directory="$(mktemp -d)"
container_name="loom-dotnet-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${test_directory}"
}
trap cleanup EXIT

podman run --rm "${image_reference}" dotnet --version | { version=$(cat); printf '%s\n' "$version" >&2; printf '%s\n' "$version"; } | grep -qx '8\.0\.427'
podman run --rm "${image_reference}" dotnet --list-runtimes \
  | grep -Eq '^Microsoft\.NETCore\.App 8\.0\.'
podman run --rm "${image_reference}" sh -c \
  'command -v curl >/dev/null && command -v git >/dev/null'

printf '%s\n' \
  '<?xml version="1.0" encoding="utf-8"?>' \
  '<configuration>' \
  '  <packageSources>' \
  '    <clear />' \
  '  </packageSources>' \
  '</configuration>' \
  >"${test_directory}/NuGet.Config"
printf '%s\n' \
  '<Project Sdk="Microsoft.NET.Sdk">' \
  '  <PropertyGroup>' \
  '    <OutputType>Exe</OutputType>' \
  '    <TargetFramework>net8.0</TargetFramework>' \
  '    <ImplicitUsings>enable</ImplicitUsings>' \
  '  </PropertyGroup>' \
  '</Project>' \
  >"${test_directory}/LoomContract.csproj"
printf '%s\n' \
  'using System.Net;' \
  'if (args is ["server"])' \
  '{' \
  '    using var listener = new HttpListener();' \
  '    listener.Prefixes.Add("http://*:8080/");' \
  '    listener.Start();' \
  '    while (true)' \
  '    {' \
  '        var context = await listener.GetContextAsync();' \
  '        var body = "loom-dotnet-ready"u8.ToArray();' \
  '        context.Response.ContentLength64 = body.Length;' \
  '        await context.Response.OutputStream.WriteAsync(body);' \
  '        context.Response.Close();' \
  '    }' \
  '}' \
  'Console.Write("loom-dotnet-ready");' \
  >"${test_directory}/Program.cs"

podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" dotnet restore --configfile NuGet.Config >/dev/null
podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" dotnet build --no-restore >/dev/null
if [[ "$(podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" dotnet run --no-build)" != "loom-dotnet-ready" ]]; then
  printf 'Built .NET application did not produce expected output\n' >&2
  exit 1
fi

podman run --detach --name "${container_name}" \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" dotnet run --no-build -- server >/dev/null

ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(podman exec "${container_name}" curl --fail --silent \
    http://127.0.0.1:8080/ 2>/dev/null)" == "loom-dotnet-ready" ]]; then
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
  sh -c 'dotnet --info >/dev/null && printf ok > contract-owned.txt'

actual_owner="$(stat -c '%u:%g' "${test_directory}/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
