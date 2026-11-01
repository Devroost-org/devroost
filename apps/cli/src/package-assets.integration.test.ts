import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const cliDistDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(cliDistDir, "..");
const repoDir = resolve(cliDir, "..", "..");

const executeFile = promisify(execFile);

async function createNpmPackage(): Promise<{ archivePath: string; cleanup(): void }> {
  const npmCache = mkdtempSync(resolve(tmpdir(), "loom-npm-cache-"));
  const packDir = mkdtempSync(resolve(tmpdir(), "loom-npm-pack-"));
  try {
    await executeFile("npm", ["pack", "--json", "--pack-destination", packDir], {
      cwd: cliDir,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: npmCache }
    });
    const archive = readdirSync(packDir).find((path) => path.endsWith(".tgz"));
    assert.ok(archive, "npm pack did not produce an archive");
    return {
      archivePath: resolve(packDir, archive),
      cleanup: () => {
        rmSync(npmCache, { recursive: true, force: true });
        rmSync(packDir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    rmSync(npmCache, { recursive: true, force: true });
    rmSync(packDir, { recursive: true, force: true });
    throw error;
  }
}

async function npmPackageFiles(): Promise<string[]> {
  const packed = await createNpmPackage();
  try {
    const { stdout } = await executeFile("tar", ["-tzf", packed.archivePath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout.trim().split("\n").map((path) => path.replace(/^package\//, "")).sort();
  } finally {
    packed.cleanup();
  }
}

function assertCanonicalStackAssets(paths: readonly string[], stacksPrefix: string): void {
  for (const required of [
    "definition.js",
    "documentation.js",
    "index.js",
    "pins.js",
    "node/stack.js",
    "node/templates/loom.yaml",
    "node-mern/templates/api/server.js",
    "node-t3/templates/apps/web/app/page.tsx"
  ]) {
    assert.ok(paths.includes(`${stacksPrefix}${required}`), `missing packaged stack asset: ${required}`);
  }

  const stackPaths = paths.filter((path) => path.startsWith(stacksPrefix));
  assert.ok(stackPaths.length > 0, "expected packaged stack assets");
  assert.equal(
    stackPaths.filter((path) => /^[^/]+\/stack\.js$/.test(path.slice(stacksPrefix.length))).length,
    31,
    "expected one compiled definition for every public stack ID"
  );
  for (const path of stackPaths) {
    const relativePath = path.slice(stacksPrefix.length);
    const segments = relativePath.split("/");
    assert.equal(segments.includes("fixtures"), false, `private fixture was packaged: ${path}`);
    assert.equal(segments.includes("node_modules"), false, `dependency was packaged: ${path}`);
    assert.equal(segments.some((segment) => [
      ".angular", ".loom", ".next", ".pnpm-store", ".pytest_cache", ".turbo", ".venv",
      "__pycache__", "bin", "build", "data", "dist", "obj", "target", "vendor"
    ].includes(segment)), false, `generated or runtime path was packaged: ${path}`);
    assert.equal(/(?:^|\/)[^/]+\.test\.[^/]+$/.test(relativePath), false, `test file was packaged: ${path}`);
    if (!relativePath.includes("/templates/")) {
      assert.equal(relativePath.endsWith(".ts"), false, `TypeScript definition source was packaged: ${path}`);
      assert.equal(relativePath.endsWith(".map"), false, `definition source map was packaged: ${path}`);
    }
  }
}

function hasLegacyExampleAssets(paths: readonly string[], parent = ""): boolean {
  const directory = [parent, "examples"].filter(Boolean).join("/");
  return paths.some((path) => path === directory || path.startsWith(`${directory}/`));
}

test("npm package publishes canonical stack assets without legacy examples", async () => {
  const paths = await npmPackageFiles();
  assertCanonicalStackAssets(paths, "dist/stacks/");
  assert.equal(hasLegacyExampleAssets(paths, "dist"), false);
});

test("npm package publishes the root README as its package documentation", async () => {
  const packed = await createNpmPackage();
  try {
    const { stdout } = await executeFile("tar", ["-xOzf", packed.archivePath, "package/README.md"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(stdout, await readFile(resolve(repoDir, "README.md"), "utf8"));
  } finally {
    packed.cleanup();
  }
});

test("npm installs the produced CLI tgz and executes its binary without workspace dependencies", async () => {
  const packed = await createNpmPackage();
  const installRoot = await mkdtemp(resolve(tmpdir(), "loom-npm-install-"));
  const npmCache = await mkdtemp(resolve(tmpdir(), "loom-npm-install-cache-"));
  const targetDir = resolve(installRoot, "generated-node");
  try {
    await executeFile("npm", ["install", "--no-audit", "--no-fund", packed.archivePath], {
      cwd: installRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: npmCache },
      maxBuffer: 10 * 1024 * 1024
    });
    await executeFile(resolve(installRoot, "node_modules", ".bin", "loom"), ["init", "node", "--dir", targetDir], {
      cwd: installRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    const installedPackage = JSON.parse(await readFile(resolve(installRoot, "node_modules", "loomdev", "package.json"), "utf8")) as {
      name: string;
      dependencies?: Record<string, string>;
    };
    assert.equal(installedPackage.name, "loomdev");
    assert.deepEqual(installedPackage.dependencies ?? {}, {});
    assert.match(await readFile(resolve(targetDir, "server.js"), "utf8"), /app\.get\('\/health'/);
    const manifest = JSON.parse(await readFile(resolve(targetDir, ".loom", "manifest.json"), "utf8")) as {
      stack: { id: string; scaffoldVersion: string; definitionVersion: number };
    };
    assert.deepEqual(manifest.stack, { id: "node", scaffoldVersion: "2", definitionVersion: 2 });
  } finally {
    packed.cleanup();
    await rm(installRoot, { recursive: true, force: true });
    await rm(npmCache, { recursive: true, force: true });
  }
});

async function isolatedCliFixture(projectDirName: string) {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "loom-packaged-cli-"));
  const packageDistDir = resolve(tempRoot, "install", "package", "dist");
  const workspaceDir = resolve(tempRoot, "workspace");
  const targetDir = resolve(workspaceDir, projectDirName);
  await mkdir(packageDistDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await cp(resolve(cliDistDir, "index.js"), resolve(packageDistDir, "index.js"));
  await cp(resolve(cliDistDir, "stacks"), resolve(packageDistDir, "stacks"), { recursive: true });
  return { tempRoot, packageDistDir, workspaceDir, targetDir };
}

test("isolated packaged CLI initializes Node from canonical stack assets", async () => {
  const value = await isolatedCliFixture("node-app");
  try {
    await executeFile(process.execPath, [resolve(value.packageDistDir, "index.js"), "init", "node", "--dir", value.targetDir], {
      cwd: value.workspaceDir,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    assert.match(await readFile(resolve(value.targetDir, "server.js"), "utf8"), /app\.get\('\/health'/);
    const manifest = JSON.parse(await readFile(resolve(value.targetDir, ".loom", "manifest.json"), "utf8")) as {
      version: number;
      stack: { id: string; scaffoldVersion: string; definitionVersion: number };
    };
    assert.equal(manifest.version, 2);
    assert.deepEqual(manifest.stack, { id: "node", scaffoldVersion: "2", definitionVersion: 2 });
  } finally {
    await rm(value.tempRoot, { recursive: true, force: true });
  }
});

test("isolated packaged CLI initializes a formerly nested stack ID", async () => {
  const value = await isolatedCliFixture("mern-app");
  try {
    await executeFile(process.execPath, [resolve(value.packageDistDir, "index.js"), "init", "node-mern", "--dir", value.targetDir], {
      cwd: value.workspaceDir,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    assert.match(await readFile(resolve(value.targetDir, "api", "server.js"), "utf8"), /stack: "MERN"/);
    assert.match(await readFile(resolve(value.targetDir, "web", "index.html"), "utf8"), /<title>MERN Example<\/title>/);
    const manifest = JSON.parse(await readFile(resolve(value.targetDir, ".loom", "manifest.json"), "utf8")) as {
      version: number;
      stack: { id: string; scaffoldVersion: string; definitionVersion: number };
    };
    assert.equal(manifest.version, 2);
    assert.deepEqual(manifest.stack, { id: "node-mern", scaffoldVersion: "2", definitionVersion: 2 });
  } finally {
    await rm(value.tempRoot, { recursive: true, force: true });
  }
});

test("release archives publish canonical stack assets without legacy examples", async () => {
  await executeFile(process.execPath, [resolve(repoDir, "scripts", "build-release-assets.mjs")], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  const releaseDir = resolve(repoDir, "dist", "release");
  for (const archive of [
    "loom-linux-x64.tar.gz",
    "loom-linux-arm64.tar.gz",
    "loom-darwin-x64.tar.gz",
    "loom-darwin-arm64.tar.gz"
  ]) {
    const { stdout } = await executeFile("tar", ["-tzf", resolve(releaseDir, archive)], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    const paths = stdout.trim().split("\n").map((path) => path.replace(/^\.\//, "")).sort();
    assert.ok(paths.includes("loom"), `${archive} is missing the Unix launcher`);
    assert.ok(paths.includes("loom.mjs"), `${archive} is missing the CLI bundle`);
    assertCanonicalStackAssets(paths, "stacks/");
    assert.equal(hasLegacyExampleAssets(paths), false);
  }

  for (const archive of ["loom-windows-x64.zip", "loom-windows-arm64.zip"]) {
    const { stdout } = await executeFile("python3", [
      "-c",
      "import json, sys, zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))",
      resolve(releaseDir, archive)
    ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    const paths = (JSON.parse(stdout) as string[]).sort();
    assert.ok(paths.includes("loom.cmd"), `${archive} is missing the Windows launcher`);
    assert.ok(paths.includes("loom.mjs"), `${archive} is missing the CLI bundle`);
    assertCanonicalStackAssets(paths, "stacks/");
    assert.equal(hasLegacyExampleAssets(paths), false);
  }
});
