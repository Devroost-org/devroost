#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { copyPublishableStackAssets } from "./copy-publishable-stack-assets.mjs";

const rootDir = process.cwd();
const releaseDir = resolve(rootDir, "dist", "release");
const stageDir = resolve(releaseDir, ".stage");
const windowsStageDir = resolve(stageDir, "windows");
const bundledCliPath = resolve(releaseDir, "devroost.mjs");
const releaseStacksDir = resolve(releaseDir, "stacks");
const unixWrapperPath = resolve(releaseDir, "devroost");

const unixWrapper = `#!/usr/bin/env sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec node "$SCRIPT_DIR/devroost.mjs" "$@"
`;

const windowsWrapper = `@echo off
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%devroost.mjs" %*
`;

const unixAssets = [
  "devroost-linux-x64.tar.gz",
  "devroost-linux-arm64.tar.gz",
  "devroost-darwin-x64.tar.gz",
  "devroost-darwin-arm64.tar.gz"
];

const windowsAssets = ["devroost-windows-x64.zip", "devroost-windows-arm64.zip"];

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(windowsStageDir, { recursive: true });
run("pnpm", ["--filter", "@loom/stacks", "build"]);
await copyPublishableStackAssets(resolve(rootDir, "stacks"), releaseStacksDir);

run("pnpm", [
  "exec",
  "esbuild",
  "apps/cli/src/index.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${bundledCliPath}`,
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
]);

await writeFile(unixWrapperPath, unixWrapper, "utf8");
await writeFile(resolve(windowsStageDir, "devroost.cmd"), windowsWrapper, "utf8");
run("chmod", ["0755", unixWrapperPath]);

for (const asset of unixAssets) {
  run("tar", [
    "-czf",
    resolve(releaseDir, asset),
    "-C",
    releaseDir,
    "devroost.mjs",
    "stacks",
    "devroost"
  ]);
}

for (const asset of windowsAssets) {
  run("python3", [
    "-c",
    "import pathlib, sys, zipfile; z=zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED); z.write(sys.argv[2], 'devroost.mjs'); z.write(sys.argv[3], 'devroost.cmd'); base=pathlib.Path(sys.argv[4]); [z.write(path, path.relative_to(base.parent).as_posix()) for path in sorted(base.rglob('*')) if path.is_file()]; z.close()",
    resolve(releaseDir, asset),
    resolve(releaseDir, "devroost.mjs"),
    resolve(windowsStageDir, "devroost.cmd"),
    releaseStacksDir
  ]);
}

await rm(stageDir, { recursive: true, force: true });
await rm(unixWrapperPath, { force: true });
