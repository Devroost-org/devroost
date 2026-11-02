import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DevroostConfig } from "@devroost/config";
import type { PodmanCapabilities } from "@devroost/runtime-podman";
import type { LoadedProjectManifest, DevroostProjectManifestV2 } from "./project-manifest.js";
import { runProjectDoctor, type DoctorProbes } from "./project-doctor.js";
import { doctorExitCode } from "./doctor-output.js";
import { findStackDefinition, type StackDefinition } from "./stacks.js";

const nodeImage = findStackDefinition("node")!.runtimeImages[0]!.reference;
const postgresImage = findStackDefinition("db-postgres")!.runtimeImages[0]!.reference;

const stack: StackDefinition = {
  id: "node", assetPath: "node", scaffoldVersion: "1", devroostOwnedFiles: ["devroost.yaml"],
  definitionVersion: 1, legacyScaffoldVersions: ["0"], generator: { kind: "none" },
  runtimeImages: [{ env: "NODE_IMAGE", reference: nodeImage }],
  install: [], start: [], readiness: { kind: "command", value: "true", timeoutSeconds: 1 }, hostWrites: [], verification: [],
  generatedPaths: [{ path: "dist", category: "build" }, { path: "node_modules", category: "dependency" }],
  protectedPaths: ["src"], compatibility: { architectures: ["x64"], runtime: "podman-rootless" }
};
const manifestValue: DevroostProjectManifestV2 = {
  version: 2, devroostVersion: "0.3.4", stack: { id: "node", scaffoldVersion: "1", definitionVersion: 1 },
  ownedFiles: {}, renderInputs: { projectName: "demo", databases: [], adopted: false }
};
const ready: LoadedProjectManifest = { kind: "ready", manifest: manifestValue };
const config: DevroostConfig = {
  version: 1, name: "demo", runtime: { engine: "podman", rootless: true },
  services: { app: { type: "node", image: nodeImage, ports: ["3000:3000"] } },
  routes: [{ host: "demo.local", service: "app", port: 3000 }]
};
const podman: PodmanCapabilities = { available: true, rootless: true, version: "5", machine: { supported: false, running: false } };
function probes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    podman: async () => podman,
    architecture: () => "x64",
    pathState: async () => ({ exists: false, writable: false }),
    portAvailable: async () => true,
    runningContainers: async () => [],
    hostsWritable: async () => true,
    ...overrides
  };
}
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "devroost-doctor-"));
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, "package-lock.json"), "{}\n");
  return root;
}

test("returns checks in stable order with healthy injected probes", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const results = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes() });
  assert.deepEqual(results.map(({ id, status }) => ({ id, status })), [
    { id: "manifest", status: "pass" }, { id: "images", status: "pass" }, { id: "podman", status: "pass" },
    { id: "architecture", status: "pass" }, { id: "lockfiles", status: "pass" },
    { id: "dependencies", status: "pass" }, { id: "ports", status: "pass" },
    { id: "routes", status: "pass" }, { id: "hosts", status: "pass" }
  ]);
});

test("diagnoses manifest lifecycle and scaffold drift", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const run = (manifest: LoadedProjectManifest, selected: StackDefinition | undefined = stack) => runProjectDoctor({ projectRoot: root, config, manifest, stack: selected, probes: probes() });
  assert.equal((await run({ kind: "missing" }))[0]!.status, "failure");
  assert.equal((await run({ kind: "migration-required", manifest: { version: 1, devroostVersion: "old", stack: { id: "node", scaffoldVersion: "0" }, ownedFiles: {} } }))[0]!.status, "warning");
  const legacy = { ...manifestValue, stack: { id: "node", scaffoldVersion: "0" } };
  assert.equal((await run({ kind: "ready", manifest: legacy }))[0]!.status, "warning");
  const drift = { ...manifestValue, stack: { id: "node", scaffoldVersion: "not-declared" } };
  assert.equal((await run({ kind: "ready", manifest: drift }))[0]!.status, "failure");
  const unknown = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack: undefined, probes: probes() });
  assert.equal(unknown[0]!.status, "failure");
});

test("reports deterministic warning-only runtime image overrides including rendered databases", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const withDatabase: DevroostProjectManifestV2 = {
    ...manifestValue,
    renderInputs: { ...manifestValue.renderInputs, databases: ["postgres"] }
  };
  const exact: DevroostConfig = {
    ...config,
    services: {
      app: { ...config.services.app! },
      database: { type: "postgres", image: postgresImage }
    }
  };
  let results = await runProjectDoctor({ projectRoot: root, config: exact, manifest: { kind: "ready", manifest: withDatabase }, stack, probes: probes() });
  assert.deepEqual(results.find(({ id }) => id === "images"), {
    id: "images",
    status: "pass",
    summary: "Runtime images match selected stack definitions"
  });

  const overridden: DevroostConfig = {
    ...exact,
    services: {
      app: { ...exact.services.app!, image: postgresImage },
      database: { ...exact.services.database!, image: nodeImage }
    }
  };
  results = await runProjectDoctor({ projectRoot: root, config: overridden, manifest: { kind: "ready", manifest: withDatabase }, stack, probes: probes() });
  assert.deepEqual(results.find(({ id }) => id === "images"), {
    id: "images",
    status: "warning",
    summary: "Runtime image overrides reduce reproducibility",
    detail: `app=${postgresImage}; database=${nodeImage}`
  });
  assert.equal(doctorExitCode(results), 0);
});

test("diagnoses Podman and architecture failures", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const unavailable = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ podman: async () => ({ ...podman, available: false }) }) });
  assert.equal(unavailable.find(({ id }) => id === "podman")!.status, "failure");
  const privileged = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ podman: async () => ({ ...podman, rootless: false }) }) });
  assert.match(privileged.find(({ id }) => id === "podman")!.summary, /not running rootless/);
  const configuredPrivileged = await runProjectDoctor({ projectRoot: root, config: { ...config, runtime: { engine: "podman", rootless: false } }, manifest: ready, stack, probes: probes() });
  assert.match(configuredPrivileged.find(({ id }) => id === "podman")!.summary, /does not enable rootless/);
  const arch = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ architecture: () => "arm64" }) });
  assert.equal(arch.find(({ id }) => id === "architecture")!.status, "failure");
});

test("reports missing and conflicting lockfiles", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "devroost-doctor-locks-")); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), "{}\n");
  let results = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes() });
  assert.equal(results.find(({ id }) => id === "lockfiles")!.status, "warning");
  await writeFile(join(root, "package-lock.json"), "{}\n"); await writeFile(join(root, "yarn.lock"), "\n");
  results = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes() });
  assert.equal(results.find(({ id }) => id === "lockfiles")!.status, "failure");
});

test("ignores dependency manifests outside the stack's declared dependency roots", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "t3", "apps", "web"), { recursive: true });
  await writeFile(join(root, "t3", "apps", "web", "package.json"), "{}\n");
  const results = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes() });
  assert.equal(results.find(({ id }) => id === "lockfiles")!.status, "pass");
});

test("evaluates Node lockfiles per workspace directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "devroost-doctor-workspace-locks-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "api")); await mkdir(join(root, "web"));
  await writeFile(join(root, "api", "package.json"), "{}\n"); await writeFile(join(root, "api", "package-lock.json"), "{}\n");
  await writeFile(join(root, "web", "package.json"), "{}\n"); await writeFile(join(root, "web", "pnpm-lock.yaml"), "\n");
  const workspaceStack: StackDefinition = {
    ...stack,
    generatedPaths: [
      { path: "api/node_modules", category: "dependency" },
      { path: "web/node_modules", category: "dependency" }
    ]
  };
  let results = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack: workspaceStack, probes: probes() });
  assert.equal(results.find(({ id }) => id === "lockfiles")!.status, "pass");
  await writeFile(join(root, "web", "yarn.lock"), "\n");
  results = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack: workspaceStack, probes: probes() });
  const lockfiles = results.find(({ id }) => id === "lockfiles")!;
  assert.equal(lockfiles.status, "failure"); assert.match(lockfiles.detail!, /web\/package\.json/);
});

test("reports dependency ownership and writability", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true })); await mkdir(join(root, "node_modules"));
  const results = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ pathState: async () => ({ exists: true, uid: (process.getuid?.() ?? 0) + 1, writable: false }) }) });
  const dependency = results.find(({ id }) => id === "dependencies")!;
  assert.equal(dependency.status, "failure"); assert.match(dependency.detail!, /not writable/); assert.match(dependency.detail!, /owned by uid/);
});

test("parses host, IP, and TCP port mappings and reports unavailable ports", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const mapped: DevroostConfig = { ...config, services: { app: { ...config.services.app!, ports: ["3000:3000", "127.0.0.1:4000:4000/tcp", "5000"] } }, routes: [{ host: "demo.local", service: "app", port: 4000 }] };
  const checked: number[] = [];
  const results = await runProjectDoctor({ projectRoot: root, config: mapped, manifest: ready, stack, probes: probes({ portAvailable: async (port) => { checked.push(port); return port !== 4000; } }) });
  assert.deepEqual(checked, [3000, 4000]); assert.equal(results.find(({ id }) => id === "ports")!.status, "failure");
  assert.equal(results.find(({ id }) => id === "routes")!.status, "pass");
});

test("accepts a bound port owned by this running project and rejects unrelated occupation", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const healthy = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ portAvailable: async () => false, runningContainers: async () => ["demo-app"] }) });
  assert.equal(healthy.find(({ id }) => id === "ports")!.status, "pass");
  const stopped = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ portAvailable: async () => false, runningContainers: async () => ["demo-app-stale"] }) });
  assert.equal(stopped.find(({ id }) => id === "ports")!.status, "failure");
  const otherProject = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ portAvailable: async () => false, runningContainers: async () => ["other-app"] }) });
  assert.equal(otherProject.find(({ id }) => id === "ports")!.status, "failure");
});

test("rejects duplicate host-port claims across services before probing availability", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const duplicate: DevroostConfig = { ...config, services: {
    api: { type: "node", image: "node", ports: ["127.0.0.1:3000:4000/tcp"] },
    web: { type: "node", image: "node", ports: ["3000:3000"] }
  }, routes: [] };
  let availabilityCalls = 0;
  const results = await runProjectDoctor({ projectRoot: root, config: duplicate, manifest: ready, stack, probes: probes({
    portAvailable: async () => { availabilityCalls++; return true; }, runningContainers: async () => ["demo-api"]
  }) });
  const ports = results.find(({ id }) => id === "ports")!;
  assert.equal(ports.status, "failure"); assert.equal(availabilityCalls, 0);
  assert.equal(ports.detail, "3000: api (127.0.0.1:3000:4000/tcp), web (3000:3000)");
});

test("rejects malformed mappings and distinguishes route service and port failures", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  const invalid: DevroostConfig = { ...config, services: { app: { ...config.services.app!, ports: ["127.0.0.1:bad:3000"] } }, routes: [{ host: "a.local", service: "missing", port: 80 }, { host: "b.local", service: "app", port: 9999 }] };
  const results = await runProjectDoctor({ projectRoot: root, config: invalid, manifest: ready, stack, probes: probes() });
  assert.equal(results.find(({ id }) => id === "ports")!.status, "failure");
  const route = results.find(({ id }) => id === "routes")!; assert.equal(route.status, "failure");
  assert.match(route.detail!, /does not exist/); assert.match(route.detail!, /does not expose/);
});

test("hosts integration is checked only when routes exist and is warning-only", async (t) => {
  const root = await fixture(); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const warning = await runProjectDoctor({ projectRoot: root, config, manifest: ready, stack, probes: probes({ hostsWritable: async () => { calls++; return false; } }) });
  assert.equal(warning.find(({ id }) => id === "hosts")!.status, "warning"); assert.equal(calls, 1);
  const noRoutes = { ...config, routes: [] };
  const pass = await runProjectDoctor({ projectRoot: root, config: noRoutes, manifest: ready, stack, probes: probes({ hostsWritable: async () => { calls++; return false; } }) });
  assert.equal(pass.find(({ id }) => id === "hosts")!.status, "pass"); assert.equal(calls, 1);
});
