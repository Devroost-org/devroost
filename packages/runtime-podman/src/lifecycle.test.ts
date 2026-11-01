import test from "node:test";
import assert from "node:assert/strict";
import type { LoomService } from "@loom/config";
import { serviceConfigHash } from "./containers.js";
import { ensureComposerAvailableWithDependencies, ensureServiceStartedWithDependencies } from "./lifecycle.js";

const service: LoomService = {
  type: "node",
  image: "node:20-alpine",
  command: "node server.js",
  ports: ["3000:3000"]
};

test("ensureServiceStarted starts an existing matching container", async () => {
  const started: string[] = [];

  await ensureServiceStartedWithDependencies("demo", "app", service, "demo-net", {
    isContainerRunningByName: async () => false,
    containerExistsByName: async () => true,
    inspectContainerImageByName: async () => "docker.io/library/node:20-alpine",
    inspectContainerLabelByName: async (_name, label) => label === "loom.project" ? "demo" : serviceConfigHash(service),
    startContainerByName: async (name) => {
      started.push(name);
    },
    removeContainerByName: async () => {
      throw new Error("should not remove");
    },
    buildRunArgs: async () => {
      throw new Error("should not build run args");
    },
    runPodmanCommand: async () => ({ ok: true, stderr: "" })
  });

  assert.deepEqual(started, ["demo-app"]);
});

test("ensureServiceStarted recreates a container when config drift is detected", async () => {
  const events: string[] = [];
  let builtArgs: string[] = [];

  await ensureServiceStartedWithDependencies("demo", "app", service, "demo-net", {
    isContainerRunningByName: async () => false,
    containerExistsByName: async () => true,
    inspectContainerImageByName: async () => "docker.io/library/node:18-alpine",
    inspectContainerLabelByName: async (_name, label) => label === "loom.project" ? "demo" : "old-hash",
    removeContainerByName: async (name) => {
      events.push(`remove:${name}`);
    },
    startContainerByName: async () => {
      throw new Error("should not start old container");
    },
    buildRunArgs: async (_serviceName, containerNameValue, _service, networkName, expectedImage) => {
      builtArgs = [containerNameValue, networkName, expectedImage];
      return ["run", "-d", containerNameValue];
    },
    runPodmanCommand: async (args) => {
      events.push(args.join(" "));
      return { ok: true, stderr: "" };
    }
  });

  assert.deepEqual(events, ["remove:demo-app", "run -d demo-app"]);
  assert.deepEqual(builtArgs, ["demo-app", "demo-net", "docker.io/library/node:20-alpine"]);
});

test("ensureServiceStarted recreates a matching container when its bind mount source is missing", async () => {
  const events: string[] = [];

  await ensureServiceStartedWithDependencies("demo", "app", service, "demo-net", {
    isContainerRunningByName: async () => false,
    containerExistsByName: async () => true,
    inspectContainerImageByName: async () => "docker.io/library/node:20-alpine",
    inspectContainerLabelByName: async (_name, label) => label === "loom.project" ? "demo" : serviceConfigHash(service),
    startContainerByName: async () => {
      throw new Error(
        "Failed to start existing container 'demo-app': Error: unable to start container 'abc': crun: cannot stat `/tmp/loom-release-smoke/demo/data/mysql`: No such file or directory: OCI runtime attempted to invoke a command that was not found"
      );
    },
    removeContainerByName: async (name) => {
      events.push(`remove:${name}`);
    },
    buildRunArgs: async () => ["run", "-d", "demo-app"],
    runPodmanCommand: async (args) => {
      events.push(args.join(" "));
      return { ok: true, stderr: "" };
    }
  });

  assert.deepEqual(events, ["remove:demo-app", "run -d demo-app"]);
});

test("ensureServiceStarted returns immediately when the container is already running", async () => {
  let checkedForExistingContainer = false;

  await ensureServiceStartedWithDependencies("demo", "app", service, "demo-net", {
    isContainerRunningByName: async () => true,
    containerExistsByName: async () => {
      checkedForExistingContainer = true;
      return true;
    },
    runPodmanCommand: async () => ({ ok: true, stderr: "" })
  });

  assert.equal(checkedForExistingContainer, false);
});

test("ensureServiceStarted reports unavailable images clearly", async () => {
  await assert.rejects(
    () =>
      ensureServiceStartedWithDependencies("demo", "app", service, "demo-net", {
        isContainerRunningByName: async () => false,
        containerExistsByName: async () => false,
        buildRunArgs: async () => ["run", "-d", "demo-app"],
        runPodmanCommand: async () => ({
          ok: false,
          stderr: "manifest unknown: manifest unknown"
        })
      }),
    /image 'node:20-alpine' is not available or could not be pulled/i
  );
});

test("ensureServiceStarted reports registry auth failures clearly", async () => {
  await assert.rejects(
    () =>
      ensureServiceStartedWithDependencies("demo", "app", service, "demo-net", {
        isContainerRunningByName: async () => false,
        containerExistsByName: async () => false,
        buildRunArgs: async () => ["run", "-d", "demo-app"],
        runPodmanCommand: async () => ({
          ok: false,
          stderr: "pull access denied for private/node, repository does not exist or may require authorization"
        })
      }),
    /image 'node:20-alpine' requires registry access or authentication:[\s\S]*podman login docker\.io/i
  );
});

test("ensureComposerAvailable reports stopped containers clearly before exec", async () => {
  await assert.rejects(
    () =>
      ensureComposerAvailableWithDependencies("demo", "app", {
        inspectContainerByName: async () => ({
          running: false,
          state: "exited"
        }),
        runPodmanCommand: async () => ({
          ok: true,
          stderr: ""
        })
      }),
    /Container 'demo-app' is not running \(state: exited\), so Composer could not be ensured\. Check 'loom logs app --no-follow'/i
  );
});

test("ensureComposerAvailable rewrites exec-session errors when the container exits", async () => {
  let inspectCalls = 0;

  await assert.rejects(
    () =>
      ensureComposerAvailableWithDependencies("demo", "app", {
        inspectContainerByName: async () => {
          inspectCalls += 1;
          return inspectCalls === 1
            ? {
                running: true,
                state: "running"
              }
            : {
                running: false,
                state: "exited"
              };
        },
        runPodmanCommand: async () => ({
          ok: false,
          stderr: "Error: can only create exec sessions on running containers: container state improper"
        })
      }),
    /Container 'demo-app' is not running \(state: exited\), so Composer could not be ensured\. Check 'loom logs app --no-follow'/i
  );
});
test("startup refuses a running container owned by another project", async () => {
  await assert.rejects(ensureServiceStartedWithDependencies("shop", "api-web", service, "shop-net", {
    containerExistsByName: async () => true,
    isContainerRunningByName: async () => true,
    inspectContainerLabelByName: async () => "shop-api",
    runPodmanCommand: async () => { throw new Error("must not mutate a foreign container"); }
  }), /Refusing to operate/);
});

test("startup renames an owned legacy container without deleting its writable layer", async () => {
  const events: string[] = [];
  const names = new Set(["shop-api-web"]);
  const currentName = "shop-api-web--p8";
  await ensureServiceStartedWithDependencies("shop-api", "web", service, "shop-net", {
    containerExistsByName: async (name) => names.has(name),
    isContainerRunningByName: async () => false,
    inspectContainerLabelByName: async (_name, label) => label === "loom.project" ? "shop-api" : serviceConfigHash(service),
    inspectContainerImageByName: async () => "docker.io/library/node:20-alpine",
    runPodmanCommand: async (args) => {
      events.push(args.join(" "));
      if (args[0] === "rename") { names.delete(args[1]!); names.add(args[2]!); }
      return { ok: true, stderr: "" };
    },
    startContainerByName: async (name) => { events.push(`start ${name}`); },
    removeContainerByName: async () => { throw new Error("must not delete legacy data"); }
  });
  assert.deepEqual(events, ["stop shop-api-web", `rename shop-api-web ${currentName}`, `start ${currentName}`]);
});
