import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectManifest,
  classifyProjectManifestStack,
  loadProjectManifest,
  writeProjectManifest
} from "./project-manifest.js";
import { findStackDefinition } from "./stacks.js";

const nodeStack = findStackDefinition("node");
if (!nodeStack) {
  throw new Error("node stack definition missing");
}

const renderInputs = {
  projectName: "devroost-demo",
  databases: ["redis", "postgres"],
  adopted: false
};

test("buildProjectManifest records v2 render inputs and baseline paths", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "devroost-manifest-"));
  try {
    await writeFile(join(targetDir, "devroost.yaml"), "version: 1\n", "utf8");

    const manifest = await buildProjectManifest(targetDir, "0.3.4", nodeStack, nodeStack.devroostOwnedFiles, renderInputs);

    const sha256 = createHash("sha256").update("version: 1\n").digest("hex");
    assert.deepEqual(manifest, {
      version: 2,
      devroostVersion: "0.3.4",
      stack: { id: "node", scaffoldVersion: "2", definitionVersion: 2 },
      ownedFiles: {
        "devroost.yaml": {
          sha256,
          baselinePath: `.devroost/baselines/${sha256}-devroost.yaml`
        }
      },
      renderInputs: {
        projectName: "devroost-demo",
        databases: ["postgres", "redis"],
        adopted: false
      }
    });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("writeProjectManifest atomically replaces deterministic JSON", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "devroost-manifest-"));
  try {
    await writeFile(join(targetDir, "devroost.yaml"), "version: 1\n", "utf8");
    await writeFile(join(targetDir, ".env.example"), "NODE_IMAGE=node:24\n", "utf8");

    const manifestPath = await writeProjectManifest(targetDir, "0.3.4", nodeStack, nodeStack.devroostOwnedFiles, renderInputs);
    const first = await readFile(manifestPath, "utf8");
    await writeProjectManifest(targetDir, "0.3.4", nodeStack, nodeStack.devroostOwnedFiles, renderInputs);
    const second = await readFile(manifestPath, "utf8");

    assert.equal(first, second);
    assert.match(first, /"devroostVersion": "0\.3\.4"/);
    assert.match(first, /"\.env\.example"/);

    const loaded = await loadProjectManifest(targetDir);
    assert.equal(loaded.kind, "ready");
    if (loaded.kind !== "ready") throw new Error("expected ready manifest");
    assert.deepEqual(loaded.manifest.renderInputs, {
      projectName: "devroost-demo",
      databases: ["postgres", "redis"],
      adopted: false
    });
    assert.equal(
      await readFile(join(targetDir, loaded.manifest.ownedFiles["devroost.yaml"].baselinePath), "utf8"),
      await readFile(join(targetDir, "devroost.yaml"), "utf8")
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("a later baseline failure cannot alter content referenced by the previous manifest", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "devroost-manifest-"));
  try {
    await writeFile(join(targetDir, "devroost.yaml"), "old devroost\n", "utf8");
    await writeFile(join(targetDir, ".env.example"), "OLD_ENV=true\n", "utf8");
    await writeProjectManifest(targetDir, "0.3.4", nodeStack, nodeStack.devroostOwnedFiles, renderInputs);
    const previous = await loadProjectManifest(targetDir);
    assert.equal(previous.kind, "ready");
    if (previous.kind !== "ready") throw new Error("expected ready manifest");
    const previousBaseline = previous.manifest.ownedFiles["devroost.yaml"].baselinePath;

    await writeFile(join(targetDir, "devroost.yaml"), "new devroost\n", "utf8");
    await writeFile(join(targetDir, ".env.example"), "NEW_ENV=true\n", "utf8");
    const envSha = createHash("sha256").update("NEW_ENV=true\n").digest("hex");
    await mkdir(join(targetDir, ".devroost", "baselines", `${envSha}-.env.example.tmp-${process.pid}`));

    await assert.rejects(
      writeProjectManifest(targetDir, "0.3.5", nodeStack, nodeStack.devroostOwnedFiles, renderInputs)
    );
    assert.equal(await readFile(join(targetDir, previousBaseline), "utf8"), "old devroost\n");
    assert.deepEqual(await loadProjectManifest(targetDir), previous);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("buildProjectManifest can record only files created during adoption", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "devroost-manifest-"));
  try {
    await writeFile(join(targetDir, "devroost.yaml"), "version: 1\n", "utf8");
    await writeFile(join(targetDir, ".env.example"), "USER_OWNED=true\n", "utf8");

    const manifest = await buildProjectManifest(targetDir, "0.3.4", nodeStack, ["devroost.yaml"], renderInputs);

    assert.deepEqual(Object.keys(manifest.ownedFiles), ["devroost.yaml"]);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("loadProjectManifest reports missing and v1 manifests distinctly", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "devroost-manifest-"));
  try {
    assert.deepEqual(await loadProjectManifest(targetDir), { kind: "missing" });
    await mkdir(join(targetDir, ".devroost"), { recursive: true });
    const v1 = {
      version: 1,
      devroostVersion: "0.3.4",
      stack: { id: "node", scaffoldVersion: "1" },
      ownedFiles: { "devroost.yaml": { sha256: "a".repeat(64) } }
    };
    await writeFile(join(targetDir, ".devroost", "manifest.json"), JSON.stringify(v1), "utf8");
    assert.deepEqual(await loadProjectManifest(targetDir), { kind: "migration-required", manifest: v1 });
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("v2 definition metadata distinguishes current, explicit legacy, and incompatible manifests", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "devroost-manifest-"));
  try {
    await mkdir(join(targetDir, ".devroost"), { recursive: true });
    const manifestPath = join(targetDir, ".devroost", "manifest.json");
    const base = {
      version: 2,
      devroostVersion: "0.3.4",
      stack: { id: "node", scaffoldVersion: "2" },
      ownedFiles: {},
      renderInputs: { projectName: "devroost-demo", databases: [], adopted: false }
    };

    await writeFile(manifestPath, JSON.stringify({
      ...base,
      stack: { ...base.stack, definitionVersion: nodeStack.definitionVersion }
    }), "utf8");
    let loaded = await loadProjectManifest(targetDir);
    assert.equal(loaded.kind, "ready");
    if (loaded.kind !== "ready") throw new Error("expected ready manifest");
    assert.deepEqual(classifyProjectManifestStack(loaded.manifest, nodeStack), { kind: "current" });

    await writeFile(manifestPath, JSON.stringify(base), "utf8");
    loaded = await loadProjectManifest(targetDir);
    assert.equal(loaded.kind, "ready");
    if (loaded.kind !== "ready") throw new Error("expected legacy-ready manifest");
    assert.deepEqual(classifyProjectManifestStack(loaded.manifest, nodeStack), { kind: "legacy-compatible" });

    await writeFile(manifestPath, JSON.stringify({ ...base, stack: { id: "node", scaffoldVersion: "not-declared" } }), "utf8");
    loaded = await loadProjectManifest(targetDir);
    assert.equal(loaded.kind, "ready");
    if (loaded.kind !== "ready") throw new Error("expected parsed incompatible manifest");
    const compatibility = classifyProjectManifestStack(loaded.manifest, nodeStack);
    assert.equal(compatibility.kind, "incompatible");
    if (compatibility.kind === "incompatible") assert.match(compatibility.reason, /not a declared legacy scaffold version/i);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("loadProjectManifest rejects unknown versions and unsafe owned paths", async () => {
  const targetDir = await mkdtemp(join(tmpdir(), "devroost-manifest-"));
  try {
    await mkdir(join(targetDir, ".devroost"), { recursive: true });
    const manifestPath = join(targetDir, ".devroost", "manifest.json");
    await writeFile(manifestPath, JSON.stringify({ version: 3 }), "utf8");
    await assert.rejects(loadProjectManifest(targetDir), /unsupported manifest version/i);

    await writeFile(manifestPath, JSON.stringify({
      version: 2,
      devroostVersion: "0.3.4",
      stack: { id: "node", scaffoldVersion: "1" },
      ownedFiles: { "../outside": { sha256: "a".repeat(64), baselinePath: ".devroost/baselines/outside" } },
      renderInputs: { projectName: "devroost-demo", databases: [], adopted: false }
    }), "utf8");
    await assert.rejects(loadProjectManifest(targetDir), /unsafe owned file path/i);

    await writeFile(manifestPath, JSON.stringify({
      version: 2,
      devroostVersion: "0.3.4",
      stack: { id: "node", scaffoldVersion: "2", definitionVersion: 2.5 },
      ownedFiles: {},
      renderInputs: { projectName: "devroost-demo", databases: [], adopted: false }
    }), "utf8");
    await assert.rejects(loadProjectManifest(targetDir), /invalid Devroost project manifest/i);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});
