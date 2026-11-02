import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoomProjectManifestV2 } from "./project-manifest.js";
import { applyProjectUpgrade, planProjectUpgrade } from "./project-upgrade.js";
import { findStackDefinition, type StackDefinition } from "./stacks.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-upgrade-"));
  const projectRoot = join(root, "project");
  const stacksRoot = join(root, "stacks");
  const assetRoot = join(stacksRoot, "node", "templates");
  await mkdir(join(projectRoot, ".devroost", "baselines"), { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await writeFile(join(assetRoot, "devroost.yaml"), "name: template\nservices:\n  app:\n    type: node\n", "utf8");
  await writeFile(join(assetRoot, ".env.example"), "NODE_IMAGE=node:24\n", "utf8");
  const oldLoom = "name: loom-demo\nservices:\n  app:\n    type: node\n";
  const oldEnv = "NODE_IMAGE=node:22\n";
  await writeFile(join(projectRoot, "devroost.yaml"), `${oldLoom}# local\n`, "utf8");
  await writeFile(join(projectRoot, "source.ts"), "developer owned\n", "utf8");
  await writeFile(join(projectRoot, ".devroost", "baselines", "loom"), oldLoom, "utf8");
  await writeFile(join(projectRoot, ".devroost", "baselines", "env"), oldEnv, "utf8");
  const stack: StackDefinition = {
    id: "node",
    assetPath: "node/templates",
    scaffoldVersion: "2",
    definitionVersion: 1, legacyScaffoldVersions: ["1"], generator: { kind: "none" }, runtimeImages: [], install: [], start: [], readiness: { kind: "command", value: "true", timeoutSeconds: 1 }, hostWrites: [], verification: [],
    devroostOwnedFiles: ["devroost.yaml", ".env.example"],
    generatedPaths: [
      { path: "dist", category: "build" },
      { path: "node_modules", category: "dependency" }
    ],
    protectedPaths: ["src"],
    compatibility: { architectures: ["arm", "arm64", "x64"], runtime: "podman-rootless" }
  };
  const manifest: LoomProjectManifestV2 = {
    version: 2,
    devroostVersion: "0.3.4",
    stack: { id: "node", scaffoldVersion: "1" },
    ownedFiles: {
      "devroost.yaml": { sha256: sha256(oldLoom), baselinePath: ".devroost/baselines/loom" },
      ".env.example": { sha256: sha256(oldEnv), baselinePath: ".devroost/baselines/env" }
    },
    renderInputs: { projectName: "loom-demo", databases: [], adopted: false }
  };
  return { root, projectRoot, stacksRoot, stack, manifest };
}

test("planner classifies only manifest-owned files and renders candidates", async () => {
  const value = await fixture();
  try {
    const plan = await planProjectUpgrade(value);
    assert.deepEqual(plan.files.map(({ path, state }) => ({ path, state })), [
      { path: ".env.example", state: "missing" },
      { path: "devroost.yaml", state: "modified" }
    ]);
    assert.equal(await readFile(plan.files[0].candidatePath, "utf8"), "NODE_IMAGE=node:24\n");
    assert.match(await readFile(plan.files[1].candidatePath, "utf8"), /^name: loom-demo$/m);
    assert.equal(plan.files.some((file) => file.path === "source.ts"), false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("planner marks baseline-identical current files unchanged and hashes identical candidates", async () => {
  const value = await fixture();
  try {
    const baseline = await readFile(join(value.projectRoot, ".devroost/baselines/loom"), "utf8");
    await writeFile(join(value.projectRoot, "devroost.yaml"), baseline, "utf8");
    await writeFile(join(value.projectRoot, ".env.example"), "NODE_IMAGE=node:24\n", "utf8");
    const plan = await planProjectUpgrade(value);
    assert.equal(plan.files.find((file) => file.path === "devroost.yaml")?.state, "unchanged");
    const env = plan.files.find((file) => file.path === ".env.example");
    assert.equal(env?.state, "modified");
    assert.equal(env?.currentSha256, env?.candidateSha256);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("planner rejects forged traversal and missing owned template assets", async () => {
  const value = await fixture();
  try {
    const forged = structuredClone(value.manifest);
    forged.ownedFiles["../outside"] = { sha256: "a".repeat(64), baselinePath: ".devroost/baselines/outside" };
    await assert.rejects(planProjectUpgrade({ ...value, manifest: forged }), /unsafe owned file path/i);

    value.stack = { ...value.stack, assetPath: "../outside" };
    await assert.rejects(planProjectUpgrade(value), /unsafe stack asset path/i);
    value.stack = { ...value.stack, assetPath: "node/templates" };

    await rm(join(value.stacksRoot, "node", "templates", ".env.example"));
    await assert.rejects(planProjectUpgrade(value), /missing Devroost-owned asset.*\.env\.example/i);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("planner replays PHP docroot and exact database definition pins", async () => {
  const value = await fixture();
  try {
    value.stack = { ...value.stack, id: "php", assetPath: "node/templates" };
    value.manifest = {
      ...value.manifest,
      stack: { id: "php", scaffoldVersion: "1" },
      renderInputs: { projectName: "loom-php", phpDocroot: "public", databases: ["postgres", "mysql", "mariadb", "mongodb", "redis"], adopted: false }
    };
    await writeFile(join(value.stacksRoot, "node", "templates", "devroost.yaml"), [
      "name: template", "services:", "  app:", "    type: php", "    command: |", "      old", "    volumes:", "      - ./:/app", ""
    ].join("\n"), "utf8");
    const plan = await planProjectUpgrade(value);
    const candidate = await readFile(plan.files.find((file) => file.path === "devroost.yaml")!.candidatePath, "utf8");
    assert.match(candidate, /^name: loom-php$/m);
    assert.match(candidate, /DocumentRoot \/app\/public/);
    const cases = [
      { db: "postgres", stackId: "db-postgres", env: "POSTGRES_IMAGE" },
      { db: "mysql", stackId: "db-mysql", env: "MYSQL_IMAGE" },
      { db: "mariadb", stackId: "db-mariadb", env: "MARIADB_IMAGE" },
      { db: "mongodb", stackId: "db-mongodb", env: "MONGO_IMAGE" },
      { db: "redis", stackId: "db-redis", env: "REDIS_IMAGE" }
    ] as const;
    for (const testCase of cases) {
      const definition = findStackDefinition(testCase.stackId)!;
      const reference = definition.runtimeImages.find(({ env }) => env === testCase.env)?.reference;
      assert.ok(reference, `${testCase.stackId} ${testCase.env}`);
      assert.match(candidate, new RegExp(`^ {2}${testCase.db}:$`, "m"));
      assert.ok(candidate.includes(`image: \${${testCase.env}:-${reference}}`), `${testCase.db} devroost.yaml`);
    }
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("applier updates missing and unchanged files while skipping modified files", async () => {
  const value = await fixture();
  try {
    const baseline = await readFile(join(value.projectRoot, ".devroost/baselines/loom"), "utf8");
    await writeFile(join(value.projectRoot, "devroost.yaml"), baseline, "utf8");
    const sourceBefore = await readFile(join(value.projectRoot, "source.ts"));
    const plan = await planProjectUpgrade(value);
    const result = await applyProjectUpgrade(plan, { forceModified: false });
    assert.deepEqual(result, { updated: [".env.example", "devroost.yaml"], skipped: [] });
    assert.equal(await readFile(join(value.projectRoot, ".env.example"), "utf8"), "NODE_IMAGE=node:24\n");
    assert.match(await readFile(join(value.projectRoot, "devroost.yaml"), "utf8"), /^name: loom-demo$/m);
    assert.deepEqual(await readFile(join(value.projectRoot, "source.ts")), sourceBefore);
    const manifest = JSON.parse(await readFile(join(value.projectRoot, ".devroost/manifest.json"), "utf8"));
    assert.equal(manifest.version, 2);
    assert.equal(manifest.stack.scaffoldVersion, "2");
    assert.equal(manifest.stack.definitionVersion, 1);
    assert.equal(manifest.ownedFiles["devroost.yaml"].sha256, sha256(await readFile(join(value.projectRoot, "devroost.yaml"), "utf8")));
    assert.equal((await readdir(join(value.projectRoot, ".devroost"))).some((path) => path.startsWith("upgrade-")), false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("planner rejects v2 manifests outside the stack's explicit compatibility metadata", async () => {
  const value = await fixture();
  try {
    value.manifest = {
      ...value.manifest,
      stack: { id: "node", scaffoldVersion: "not-declared" }
    };
    await assert.rejects(planProjectUpgrade(value), /incompatible.*not a declared legacy scaffold version/i);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("applier replaces modified files only when forced", async () => {
  const value = await fixture();
  try {
    let plan = await planProjectUpgrade(value);
    assert.deepEqual(await applyProjectUpgrade(plan, { forceModified: false }), { updated: [".env.example"], skipped: ["devroost.yaml"] });
    assert.match(await readFile(join(value.projectRoot, "devroost.yaml"), "utf8"), /# local/);
    plan = await planProjectUpgrade(value);
    assert.deepEqual(await applyProjectUpgrade(plan, { forceModified: true }), { updated: [".env.example", "devroost.yaml"], skipped: [] });
    assert.doesNotMatch(await readFile(join(value.projectRoot, "devroost.yaml"), "utf8"), /# local/);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("applier preserves manifest and baselines when a destination write fails", async () => {
  const value = await fixture();
  try {
    await writeFile(join(value.projectRoot, ".devroost", "manifest.json"), "old manifest\n", "utf8");
    const baselineBefore = await readFile(join(value.projectRoot, ".devroost", "baselines", "loom"));
    const plan = await planProjectUpgrade(value);
    await mkdir(join(value.projectRoot, ".env.example"));
    await assert.rejects(applyProjectUpgrade(plan, { forceModified: true }));
    assert.equal(await readFile(join(value.projectRoot, ".devroost", "manifest.json"), "utf8"), "old manifest\n");
    assert.deepEqual(await readFile(join(value.projectRoot, ".devroost", "baselines", "loom")), baselineBefore);
    assert.equal((await readdir(join(value.projectRoot, ".devroost"))).some((path) => path.startsWith("upgrade-")), false);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("applier rejects symlinked owned files and parent directories that escape the project", async () => {
  for (const parentSymlink of [false, true]) {
    const value = await fixture();
    try {
      const outside = join(value.root, "outside");
      await mkdir(outside);
      const path = parentSymlink ? "owned/devroost.yaml" : "devroost.yaml";
      value.stack = { ...value.stack, devroostOwnedFiles: [path] };
      value.manifest = { ...value.manifest, ownedFiles: { [path]: value.manifest.ownedFiles["devroost.yaml"] } };
      await mkdir(join(value.stacksRoot, "node", "templates", "owned"), { recursive: true });
      await writeFile(join(value.stacksRoot, "node", "templates", path), "name: template\n", "utf8");
      if (parentSymlink) await symlink(outside, join(value.projectRoot, "owned"));
      else {
        await rm(join(value.projectRoot, "devroost.yaml"));
        await symlink(join(outside, "escaped.yaml"), join(value.projectRoot, "devroost.yaml"));
      }
      const plan = await planProjectUpgrade(value);
      await assert.rejects(applyProjectUpgrade(plan, { forceModified: true }), /symlink/i);
      await assert.rejects(lstat(join(outside, parentSymlink ? "devroost.yaml" : "escaped.yaml")));
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  }
});
