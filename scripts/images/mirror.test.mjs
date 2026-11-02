import assert from "node:assert/strict";
import test from "node:test";

import { createMirrorCopy, mirrorImage } from "./mirror.mjs";
import { readinessProbe, testMirror } from "./test-mirror.mjs";

const mirror = {
  name: "postgres-16",
  kind: "mirror",
  source: `docker.io/library/postgres:16@sha256:${"a".repeat(64)}`,
  version: "16.9-alpine",
  platforms: ["linux/amd64", "linux/arm64"]
};

test("constructs a manifest-list copy without a shell", () => {
  assert.deepEqual(createMirrorCopy(mirror, "ghcr.io/devroost-org"), {
    command: "skopeo",
    args: [
      "copy",
      "--all",
      `docker://docker.io/library/postgres@sha256:${"a".repeat(64)}`,
      "docker://ghcr.io/devroost-org/postgres-16:16.9-alpine"
    ],
    source: `docker.io/library/postgres@sha256:${"a".repeat(64)}`,
    destination: "ghcr.io/devroost-org/postgres-16:16.9-alpine"
  });
});

test("rejects a tag-only source and a mirror with a build context", () => {
  assert.throws(
    () => createMirrorCopy({ ...mirror, source: "docker.io/postgres:16" }, "ghcr.io/test"),
    /digest-pinned source/
  );
  assert.throws(
    () => createMirrorCopy({ ...mirror, context: "images/postgres" }, "ghcr.io/test"),
    /must not have a build context/
  );
});

test("copies all platforms and verifies source and destination digests", async () => {
  const calls = [];
  const digest = `sha256:${"a".repeat(64)}`;

  const result = await mirrorImage("postgres-16", {
    catalog: { registry: "ghcr.io/devroost-org", images: [mirror] },
    execute: async (command, args) => calls.push({ command, args }),
    inspect: async (reference) => {
      calls.push({ inspect: reference });
      return digest;
    }
  });

  assert.equal(result.digest, digest);
  assert.deepEqual(calls, [
    { command: "skopeo", args: createMirrorCopy(mirror, "ghcr.io/devroost-org").args },
    { inspect: `docker.io/library/postgres@sha256:${"a".repeat(64)}` },
    { inspect: "ghcr.io/devroost-org/postgres-16:16.9-alpine" }
  ]);
});

test("rejects a destination digest changed during mirroring", async () => {
  const digests = [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`];
  await assert.rejects(
    mirrorImage("postgres-16", {
      catalog: { registry: "ghcr.io/devroost-org", images: [mirror] },
      execute: async () => {},
      inspect: async () => digests.shift()
    }),
    /digest mismatch/
  );
});

test("defines native readiness probes for every infrastructure mirror", () => {
  for (const name of [
    "postgres-16",
    "mysql-8.4",
    "mariadb-11.8",
    "redis-7.4",
    "mongo-7.0",
    "elasticsearch-8.19",
    "mssql-2022"
  ]) {
    const probe = readinessProbe(name);
    assert.ok(probe.environment.length > 0 || name === "redis-7.4");
    assert.ok(probe.command.length > 0);
  }
  assert.throws(() => readinessProbe("unknown"), /has no readiness probe/);
});

test("starts the upstream entrypoint, waits for readiness, and removes the container", async () => {
  const calls = [];
  let probeAttempts = 0;
  await testMirror("redis-7.4", "ghcr.io/devroost-org/redis-7.4@sha256:test", {
    attempts: 2,
    interval: 0,
    execute: async (command, args) => {
      calls.push({ command, args });
      if (args[0] === "exec" && probeAttempts++ === 0) throw new Error("not ready");
    }
  });

  assert.equal(calls[0].args[0], "run");
  assert.equal(calls[0].args.at(-1), "ghcr.io/devroost-org/redis-7.4@sha256:test");
  assert.deepEqual(calls[2].args.slice(-2), ["redis-cli", "ping"]);
  assert.deepEqual(calls.at(-1).args.slice(0, 2), ["rm", "--force"]);
});

test("does not fail a successful readiness probe when Podman cleanup fails", async () => {
  const cleanupErrors = [];

  await testMirror("mysql-8.4", "ghcr.io/devroost-org/mysql-8.4@sha256:test", {
    attempts: 1,
    interval: 0,
    reportCleanupError: (message) => cleanupErrors.push(message),
    execute: async (_command, args) => {
      if (args[0] === "rm") throw new Error("container PID did not die");
    }
  });

  assert.equal(cleanupErrors.length, 1);
  assert.match(cleanupErrors[0], /container PID did not die/);
});
