import test from "node:test";
import assert from "node:assert/strict";
import type { DevroostService } from "@devroost/config";
import {
  assertContainerOwnership,
  containerName,
  buildPodmanRunArgs,
  ipv4ForwardingError,
  listProjectContainers,
  normalizeImage,
  parseHostPorts,
  serviceConfigHash
} from "./containers.js";

test("ipv4ForwardingError reports disabled forwarding only on Linux", () => {
  assert.match(ipv4ForwardingError("linux", "0\n") ?? "", /sudo sysctl -w net\.ipv4\.ip_forward=1/);
  assert.equal(ipv4ForwardingError("linux", "1\n"), null);
  assert.equal(ipv4ForwardingError("darwin", "0\n"), null);
  assert.equal(ipv4ForwardingError("win32", "0\n"), null);
});

test("normalizeImage prefixes library images and preserves registry paths", () => {
  assert.equal(normalizeImage("redis:7"), "docker.io/library/redis:7");
  assert.equal(normalizeImage("ghcr.io/demo/app:latest"), "ghcr.io/demo/app:latest");
});

test("parseHostPorts returns only valid host ports", () => {
  assert.deepEqual(parseHostPorts(["8080:80", "127.0.0.1:5432:5432", "invalid"]), [8080, 5432]);
});

test("serviceConfigHash is stable across env key ordering and changes on config changes", () => {
  const left: DevroostService = {
    type: "node",
    image: "node:20-alpine",
    env: {
      B: "2",
      A: "1"
    }
  };
  const right: DevroostService = {
    type: "node",
    image: "node:20-alpine",
    env: {
      A: "1",
      B: "2"
    }
  };
  const changed: DevroostService = {
    type: "node",
    image: "node:22-alpine",
    env: {
      A: "1",
      B: "2"
    }
  };
  const changedUser: DevroostService = {
    type: "node",
    image: "node:20-alpine",
    user: "1000:1000",
    env: {
      A: "1",
      B: "2"
    }
  };

  assert.equal(serviceConfigHash(left), serviceConfigHash(right));
  assert.notEqual(serviceConfigHash(left), serviceConfigHash(changed));
  assert.notEqual(serviceConfigHash(left), serviceConfigHash(changedUser));
});

test("buildPodmanRunArgs includes labels, env, ports, and shell command", async () => {
  const service: DevroostService = {
    type: "node",
    image: "node:20-alpine",
    user: "1000:1000",
    userns: "keep-id",
    command: "node server.js",
    workdir: "/workspace",
    entrypoint: "node",
    ports: ["3000:3000"],
    env: {
      NODE_ENV: "development"
    }
  };

  const args = await buildPodmanRunArgs(
    "app",
    "demo-app",
    service,
    "demo-net",
    "docker.io/library/node:20-alpine",
    "service-hash"
  );

  assert.deepEqual(args, [
    "run",
    "-d",
    "--name",
    "demo-app",
    "--network",
    "demo-net",
    "--network-alias",
    "app",
    "-w",
    "/workspace",
    "--userns=keep-id",
    "--user",
    "1000:1000",
    "--entrypoint",
    "node",
    "-p",
    "3000:3000",
    "-e",
    "NODE_ENV=development",
    "--label",
    "devroost.project=demo",
    "--label",
    "devroost.service-hash=service-hash",
    "docker.io/library/node:20-alpine",
    "sh",
    "-c",
    "node server.js"
  ]);
});


test("project container lookup uses exact ownership instead of overlapping name prefixes", async () => {
  for (const project of ["shop", "shop-api", "shop.v2"]) {
    const owned = `${project}-web`;
    const foreign = `${project}-api-web`;
    const containers = await listProjectContainers(project, {
      runPodmanCommand: async (args) => {
        assert.deepEqual(args, ["ps", "-a", "--filter", `label=devroost.project=${project}`, "--format", "{{.Names}}"]);
        // Model Podman's exact label match; a name-prefix query would include foreign.
        return { ok: true, stdout: args.includes(`label=devroost.project=${project}`) ? owned : `${owned}\n${foreign}`, stderr: "", code: 0 };
      },
      inspectContainerByName: async (name) => ({ name, state: "running", running: true, image: "test" })
    });
    assert.deepEqual(containers.map(({ name }) => name), [owned]);
  }
});

test("container names distinguish hyphens in project and service identifiers", () => {
  assert.notEqual(containerName("shop", "api-web"), containerName("shop-api", "web"));
  assert.equal(containerName("demo", "app"), "demo-app");
});

test("container ownership refuses a foreign project before operations", async () => {
  await assert.rejects(assertContainerOwnership("shop", "shop-web", async () => "other"), /Refusing to operate/);
  await assertContainerOwnership("shop", "shop-web", async () => "shop");
  await assert.rejects(assertContainerOwnership("shop-api", containerName("shop-api", "web"), async () => ""), /unlabeled/);
});
