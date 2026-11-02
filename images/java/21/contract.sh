#!/usr/bin/env bash
set -euo pipefail

image_reference="${1:?usage: contract.sh <image-reference>}"
test_directory="$(mktemp -d)"
container_name="devroost-java-contract-$$"

cleanup() {
  podman rm --force "${container_name}" >/dev/null 2>&1 || true
  rm -rf "${test_directory}"
}
trap cleanup EXIT

java_version="$(podman run --rm "${image_reference}" java -version 2>&1)"
grep -Eq 'version "21\.' <<<"${java_version}"
maven_version="$(podman run --rm "${image_reference}" mvn --version)"
grep -Eq '^Apache Maven 3\.9\.' <<<"${maven_version}"
podman run --rm "${image_reference}" sh -c \
  'command -v javac >/dev/null && command -v jar >/dev/null && command -v git >/dev/null'

mkdir -p "${test_directory}/src" "${test_directory}/classes"
printf '%s\n' \
  'public final class DevroostContract {' \
  '  public static void main(String[] args) {' \
  '    System.out.print("devroost-java-ready");' \
  '  }' \
  '}' \
  >"${test_directory}/src/DevroostContract.java"

podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" sh -c \
  'javac -d classes src/DevroostContract.java && jar --create --file devroost-contract.jar --main-class DevroostContract -C classes .'
if [[ "$(podman run --rm \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" java -jar devroost-contract.jar)" != "devroost-java-ready" ]]; then
  printf 'Packaged Java application did not produce expected output\n' >&2
  exit 1
fi

printf '%s\n' \
  'import com.sun.net.httpserver.HttpServer;' \
  'import java.net.InetSocketAddress;' \
  'import java.nio.charset.StandardCharsets;' \
  'public final class Server {' \
  '  public static void main(String[] args) throws Exception {' \
  '    var server = HttpServer.create(new InetSocketAddress("0.0.0.0", 8080), 0);' \
  '    server.createContext("/", exchange -> {' \
  '      var body = "devroost-java-ready".getBytes(StandardCharsets.UTF_8);' \
  '      exchange.sendResponseHeaders(200, body.length);' \
  '      exchange.getResponseBody().write(body);' \
  '      exchange.close();' \
  '    });' \
  '    server.start();' \
  '  }' \
  '}' \
  >"${test_directory}/Server.java"
printf '%s\n' \
  'import java.net.URI;' \
  'import java.net.http.HttpClient;' \
  'import java.net.http.HttpRequest;' \
  'import java.net.http.HttpResponse;' \
  'public final class Probe {' \
  '  public static void main(String[] args) throws Exception {' \
  '    var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080")).build();' \
  '    System.out.print(HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()).body());' \
  '  }' \
  '}' \
  >"${test_directory}/Probe.java"

podman run --detach --name "${container_name}" \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract \
  "${image_reference}" java Server.java >/dev/null

ready=0
for _attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(podman exec "${container_name}" java /contract/Probe.java \
    2>/dev/null)" == "devroost-java-ready" ]]; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  podman logs "${container_name}" >&2
  exit 1
fi

printf '%s\n' \
  'import java.nio.file.Files;' \
  'import java.nio.file.Path;' \
  'public final class WriteFile {' \
  '  public static void main(String[] args) throws Exception {' \
  '    Files.writeString(Path.of("contract-owned.txt"), "ok");' \
  '  }' \
  '}' \
  >"${test_directory}/WriteFile.java"
host_uid="$(id -u)"
host_gid="$(id -g)"
podman run --rm --user "${host_uid}:${host_gid}" --userns keep-id \
  --volume "${test_directory}:/contract:Z" \
  --workdir /contract "${image_reference}" java WriteFile.java

actual_owner="$(stat -c '%u:%g' "${test_directory}/contract-owned.txt")"
if [[ "${actual_owner}" != "${host_uid}:${host_gid}" ]]; then
  printf 'Expected host-owned file %s:%s, got %s\n' \
    "${host_uid}" "${host_gid}" "${actual_owner}" >&2
  exit 1
fi
