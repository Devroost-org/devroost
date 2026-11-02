import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const distDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(distDir, "..", "..");
const executeFile = promisify(execFile);

async function repositoryFiles(...args: string[]): Promise<string[]> {
  const { stdout } = await executeFile("git", ["ls-files", "-z", ...args], {
    cwd: repoDir,
    encoding: "utf8"
  });
  return stdout.split("\0").filter(Boolean);
}

function isRemovedLayoutProse(path: string, line: string): boolean {
  return extname(path) === ".md" && /`examples\/`/.test(line) && /\b(?:former|historical|removed|no longer)\b/i.test(line);
}

function isRepositorySourcePath(path: string): boolean {
  return !path.split("/").some((segment) => segment === "node_modules");
}

test("active repository content has no legacy generator-path references", async () => {
  const searchableExtensions = new Set([".js", ".json", ".md", ".mjs", ".ps1", ".sh", ".ts", ".yaml", ".yml"]);
  const historicalMigrationDocs = [
    ".superpowers/sdd/",
    "docs/superpowers/plans/",
    "docs/superpowers/specs/2026-08-17-versioned-stacks-release-gate-design.md"
  ];
  const examplesPrefix = ["examples", ""].join("/");
  const runnablePrefix = `${examplesPrefix}runnable`;
  const legacyReference = new RegExp(`\\b${examplesPrefix}(?!runnable(?:/|\\b))`);
  const violations: string[] = [];

  for (const path of await repositoryFiles("--cached", "--others", "--exclude-standard")) {
    if (!isRepositorySourcePath(path)) continue;
    if (historicalMigrationDocs.some((prefix) => path.startsWith(prefix))) continue;
    if (path.startsWith(runnablePrefix)) continue;
    if (!searchableExtensions.has(extname(path))) continue;
    const absolutePath = resolve(repoDir, path);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;

    for (const [index, line] of readFileSync(absolutePath, "utf8").split("\n").entries()) {
      if (legacyReference.test(line) && !isRemovedLayoutProse(path, line)) {
        violations.push(`${path}:${index + 1}:${line.trim()}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("legacy reference guard excludes installed dependency sources", () => {
  assert.equal(isRepositorySourcePath("node_modules/package/README.md"), false);
  assert.equal(isRepositorySourcePath("packages/example/node_modules/package/README.md"), false);
  assert.equal(isRepositorySourcePath("packages/example/README.md"), true);
});

test("legacy reference guard permits removed-layout prose but rejects operational paths", () => {
  const examplesRoot = ["examples", ""].join("/");
  assert.equal(isRemovedLayoutProse("README.md", `The legacy \`${examplesRoot}\` generator layout was removed.`), true);
  for (const line of [
    `Run \`devroost start --config ${examplesRoot}node/devroost.yaml\`.`,
    `Copy assets from \`${examplesRoot}php\`.`,
    `The \`${examplesRoot}\` directory contains generator templates.`,
    `Use the legacy \`${examplesRoot}\` generator layout.`
  ]) assert.equal(isRemovedLayoutProse("README.md", line), false, line);
  assert.equal(isRemovedLayoutProse("scripts/smoke.sh", `# removed ${examplesRoot} layout`), false);
});

test("canonical stack packages contain no tracked generated artifacts", async () => {
  const generatedPath = /(?:^|\/)(?:\.angular|\.devroost|\.next|\.pnpm-store|\.pytest_cache|\.turbo|\.venv|__pycache__|bin|build|data|dist|node_modules|obj|target|vendor)(?:\/|$)|(?:\.pyc|\.tsbuildinfo)$/;
  const violations = (await repositoryFiles("stacks")).filter((path) => generatedPath.test(path));

  assert.deepEqual(violations, []);
});

test("verified runnable boundary is the only examples content", () => {
  const examplesDir = resolve(repoDir, "examples");
  assert.deepEqual(readdirSync(examplesDir), ["runnable"]);
  assert.deepEqual(readdirSync(resolve(examplesDir, "runnable")), ["README.md"]);
});

test("generated-stack smoke initializes disposable projects by public ID", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoDir, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.scripts["smoke:examples"], undefined);
  assert.equal(packageJson.scripts["smoke:generated"], "./scripts/smoke-generated-stacks.sh");

  const smoke = readFileSync(resolve(repoDir, "scripts", "smoke-generated-stacks.sh"), "utf8");
  assert.match(smoke, /run_devroost init "\$stack_id" --dir "\$project_dir"/);
  assert.doesNotMatch(smoke, /stacks\/[^\s]+\/templates\/devroost\.yaml/);
  const sqliteVerification = smoke.match(/db-sqlite\)([\s\S]*?)\n {6};;/)?.[1] ?? "";
  const sqliteQuery = sqliteVerification.indexOf("run_devroost exec db -- sqlite3 /data/devroost.db");
  const sqliteOwner = sqliteVerification.indexOf("assert_owner data/sqlite/devroost.db");
  const sqliteWritable = sqliteVerification.indexOf("assert_writable data/sqlite/devroost.db");
  assert.ok(sqliteQuery >= 0 && sqliteQuery < sqliteOwner && sqliteOwner < sqliteWritable);
  assert.match(smoke, /work_root_marker/);
  assert.match(smoke, /created_projects_file/);
  assert.doesNotMatch(smoke, /for project_dir in "\$work_root"\/\*/);
  const cleanupHelper = smoke.match(/force_cleanup_project\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.doesNotMatch(cleanupHelper, /project_name/);
});

test("published-image smoke validates and pulls the generated GHCR digest", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoDir, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.scripts["smoke:published-image"], "./scripts/smoke-published-stack-image.sh");

  const wrapper = readFileSync(resolve(repoDir, "scripts", "smoke-published-stack-image.sh"), "utf8");
  assert.match(wrapper, /DEVROOST_PUBLISHED_IMAGE_PREFLIGHT=1/);
  assert.match(wrapper, /DEVROOST_PUBLISHED_SMOKE_KEEP/);
  assert.match(wrapper, /smoke-generated-stacks\.sh/);

  const smoke = readFileSync(resolve(repoDir, "scripts", "smoke-generated-stacks.sh"), "utf8");
  assert.ok(smoke.includes("^ghcr\\.io/devroost-org/[^@]+@sha256:[a-f0-9]{64}$"));
  assert.match(smoke, /podman pull/);
  const init = smoke.indexOf('run_devroost init "$stack_id"');
  const pull = smoke.indexOf('podman pull "$image_reference"');
  const start = smoke.indexOf("run_devroost start --recreate");
  assert.ok(init >= 0 && init < pull && pull < start);
});

test("generated-stack smoke refuses a pre-existing custom workspace", async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "devroost-smoke-root-test-"));
  const sharedRoot = resolve(tempRoot, "shared");
  const sentinel = resolve(sharedRoot, "sentinel.txt");
  await mkdir(sharedRoot);
  await writeFile(sentinel, "do not touch\n");

  try {
    await assert.rejects(
      executeFile("sh", [resolve(repoDir, "scripts", "smoke-generated-stacks.sh"), "unsupported-stack"], {
        cwd: repoDir,
        encoding: "utf8",
        env: { ...process.env, DEVROOST_GENERATED_SMOKE_DIR: sharedRoot, DEVROOST_GENERATED_SMOKE_KEEP: "0" }
      }),
      (error: unknown) => {
        const stderr = String((error as { stderr?: string }).stderr ?? "");
        assert.match(stderr, /custom smoke workspace.*must not already exist/i);
        return true;
      }
    );
    assert.equal(await readFile(sentinel, "utf8"), "do not touch\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
