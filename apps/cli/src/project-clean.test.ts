import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoomProjectManifestV2 } from "./project-manifest.js";
import { applyProjectClean, planProjectClean } from "./project-clean.js";
import { findStackDefinition, type StackDefinition, type StackGeneratedPath } from "./stacks.js";

async function fixture(generatedPaths: readonly StackGeneratedPath[] = [
  { path: "dist", category: "build" },
  { path: "node_modules", category: "dependency" }
]) {
  const root = await mkdtemp(join(tmpdir(), "loom-clean-"));
  const projectRoot = join(root, "project");
  await mkdir(join(projectRoot, ".devroost", "database"), { recursive: true });
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, ".devroost", "database", "data"), "database\n");
  await writeFile(join(projectRoot, "src", "app.ts"), "source\n");
  await writeFile(join(projectRoot, "devroost.yaml"), "name: demo\n");
  await writeFile(join(projectRoot, ".env"), "SECRET=value\n");
  await writeFile(join(projectRoot, "package.json"), "{}\n");
  await writeFile(join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(join(projectRoot, "notes.txt"), "unrelated\n");
  const stack: StackDefinition = {
    id: "node", assetPath: "node", scaffoldVersion: "1", devroostOwnedFiles: ["devroost.yaml"],
    definitionVersion: 1, legacyScaffoldVersions: [], generator: { kind: "none" }, runtimeImages: [], install: [], start: [], readiness: { kind: "command", value: "true", timeoutSeconds: 1 }, hostWrites: [], verification: [],
    generatedPaths, protectedPaths: ["src"],
    compatibility: { architectures: ["x64"], runtime: "podman-rootless" }
  };
  const manifest: LoomProjectManifestV2 = {
    version: 2, devroostVersion: "0.3.4", stack: { id: "node", scaffoldVersion: "1" },
    ownedFiles: { "devroost.yaml": { sha256: "a".repeat(64), baselinePath: ".devroost/baselines/loom" } },
    renderInputs: { projectName: "demo", databases: [], adopted: false }
  };
  return { root, projectRoot, stack, manifest };
}

test("planner sorts generated paths and totals regular files without changing the project", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.projectRoot, "dist", "nested"), { recursive: true });
    await writeFile(join(value.projectRoot, "dist", "nested", "app.js"), "built output\n");
    const before = await readFile(join(value.projectRoot, "notes.txt"));
    const plan = await planProjectClean(value);
    assert.deepEqual(plan.items.map(({ path, exists }) => ({ path, exists })), [
      { path: "dist", exists: true },
      { path: "node_modules", exists: false }
    ]);
    assert.equal(plan.totalBytes, Buffer.byteLength("built output\n"));
    assert.deepEqual(await readFile(join(value.projectRoot, "notes.txt")), before);
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("planner returns an empty plan for stacks without generated paths", async () => {
  const value = await fixture([]);
  try {
    assert.deepEqual(await planProjectClean(value), {
      projectRoot: value.projectRoot, items: [], totalBytes: 0,
      protectedPaths: [".env", "devroost.yaml", "package.json", "pnpm-lock.yaml", "src"]
    });
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("planner rejects unsafe and protected declarations before returning a plan", async () => {
  const cases = ["", ".", "../outside", "/tmp/outside", "bad\\path", ".devroost", ".devroost/cache", "devroost.yaml", ".env", "package.json", "pnpm-lock.yaml", "src", "owned/devroost.yaml"];
  for (const path of cases) {
    const value = await fixture([{ path, category: "cache" }]);
    try {
      value.manifest.ownedFiles["owned/devroost.yaml"] = { sha256: "b".repeat(64), baselinePath: ".devroost/baselines/owned" };
      await assert.rejects(planProjectClean(value), /unsafe|protected/i, path);
    } finally { await rm(value.root, { recursive: true, force: true }); }
  }
});

test("planner rejects symlinked targets and parents", async () => {
  for (const kind of ["target", "parent"] as const) {
    const path = kind === "parent" ? "cache/generated" : "cache";
    const value = await fixture([{ path, category: "cache" }]);
    try {
      const outside = join(value.root, "outside");
      await mkdir(outside);
      if (kind === "target") await symlink(outside, join(value.projectRoot, "cache"));
      if (kind === "parent") await symlink(outside, join(value.projectRoot, "cache"));
      await assert.rejects(planProjectClean(value), /symlink/i);
    } finally { await rm(value.root, { recursive: true, force: true }); }
  }
});

test("planner does not follow package-manager symlinks inside a generated tree", async () => {
  const value = await fixture([{ path: "node_modules", category: "dependency" }]);
  try {
    const outside = join(value.root, "outside");
    await mkdir(join(value.projectRoot, "node_modules", ".bin"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "tool"), "outside data\n");
    await writeFile(join(value.projectRoot, "node_modules", "package.js"), "dependency\n");
    await symlink(join(outside, "tool"), join(value.projectRoot, "node_modules", ".bin", "tool"));

    const plan = await planProjectClean(value);
    assert.equal(plan.totalBytes, Buffer.byteLength("dependency\n"));
    assert.deepEqual(await applyProjectClean(plan), { removed: ["node_modules"], missing: [] });
    assert.equal(await readFile(join(outside, "tool"), "utf8"), "outside data\n");
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("planner permits dependency manifests nested within a declared generated target", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.projectRoot, "node_modules", "dependency"), { recursive: true });
    await writeFile(join(value.projectRoot, "node_modules", "dependency", "package.json"), "{\"name\":\"dependency\"}\n");
    await writeFile(join(value.projectRoot, "node_modules", "dependency", "Gemfile.lock"), "dependency lock\n");
    const plan = await planProjectClean(value);
    assert.equal(plan.items.find((item) => item.path === "node_modules")?.exists, true);
    assert.deepEqual(await applyProjectClean(plan), { removed: ["node_modules"], missing: ["dist"] });
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("planner discovers and protects project and workspace manifests outside generated roots", async () => {
  const value = await fixture([{ path: "api/node_modules", category: "dependency" }]);
  try {
    value.stack = { ...value.stack, protectedPaths: ["api/src"] };
    await mkdir(join(value.projectRoot, "api", "node_modules", "dependency"), { recursive: true });
    await writeFile(join(value.projectRoot, "api", "package.json"), "{\"name\":\"workspace\"}\n");
    await writeFile(join(value.projectRoot, "api", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(value.projectRoot, "api", "node_modules", "dependency", "package.json"), "{}\n");
    const plan = await planProjectClean(value);
    assert.equal(plan.protectedPaths.includes("package.json"), true);
    assert.equal(plan.protectedPaths.includes("api/package.json"), true);
    assert.equal(plan.protectedPaths.includes("api/pnpm-lock.yaml"), true);
    assert.equal(plan.protectedPaths.includes("api/node_modules/dependency/package.json"), false);

    await assert.rejects(
      planProjectClean({ ...value, stack: { ...value.stack, generatedPaths: [{ path: "api", category: "dependency" }] } }),
      /protected/i
    );
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("executor removes only planned paths, reports missing paths, and preserves protected state", async () => {
  const value = await fixture();
  try {
    await mkdir(join(value.projectRoot, "dist"));
    await writeFile(join(value.projectRoot, "dist", "app.js"), "output\n");
    const preserved = [".devroost/database/data", "src/app.ts", "devroost.yaml", ".env", "package.json", "pnpm-lock.yaml", "notes.txt"];
    const snapshots = new Map(await Promise.all(preserved.map(async (path) => [path, await readFile(join(value.projectRoot, path))] as const)));
    const result = await applyProjectClean(await planProjectClean(value));
    assert.deepEqual(result, { removed: ["dist"], missing: ["node_modules"] });
    for (const [path, contents] of snapshots) assert.deepEqual(await readFile(join(value.projectRoot, path)), contents);
  } finally { await rm(value.root, { recursive: true, force: true }); }
});

test("executor removes the complete declared Python maintenance set", async () => {
  for (const id of ["python-django", "django-react"] as const) {
    const definition = findStackDefinition(id)!;
    const value = await fixture(definition.generatedPaths);
    try {
      value.stack = definition;
      value.manifest = {
        ...value.manifest,
        stack: {
          id: definition.id,
          scaffoldVersion: definition.scaffoldVersion,
          definitionVersion: definition.definitionVersion
        }
      };
      for (const { path } of definition.generatedPaths) {
        await mkdir(join(value.projectRoot, path), { recursive: true });
        await writeFile(join(value.projectRoot, path, "generated"), `${path}\n`);
      }

      const result = await applyProjectClean(await planProjectClean(value));
      assert.deepEqual(result, {
        removed: definition.generatedPaths.map(({ path }) => path).sort((a, b) => a.localeCompare(b)),
        missing: []
      }, id);
      assert.equal(await readFile(join(value.projectRoot, "package.json"), "utf8"), "{}\n");
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  }
});

test("executor revalidates each target and stops when a target becomes a symlink", async () => {
  const value = await fixture([
    { path: "a-cache", category: "cache" },
    { path: "b-cache", category: "cache" },
    { path: "c-cache", category: "cache" }
  ]);
  try {
    for (const path of ["a-cache", "b-cache", "c-cache"]) {
      await mkdir(join(value.projectRoot, path));
      await writeFile(join(value.projectRoot, path, "data"), path);
    }
    const plan = await planProjectClean(value);
    const outside = join(value.root, "outside");
    await mkdir(outside);
    await rm(join(value.projectRoot, "b-cache"), { recursive: true });
    await symlink(outside, join(value.projectRoot, "b-cache"));
    await assert.rejects(applyProjectClean(plan), /symlink/i);
    await assert.rejects(readFile(join(value.projectRoot, "a-cache", "data")));
    assert.equal(await readFile(join(value.projectRoot, "c-cache", "data"), "utf8"), "c-cache");
  } finally { await rm(value.root, { recursive: true, force: true }); }
});
