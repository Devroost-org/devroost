import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("multi-line Java and PHP probes cannot trigger pipefail through grep --quiet", async () => {
  for (const contract of ["images/java/21/contract.sh", "images/php/contract.sh"]) {
    const source = await readFile(path.join(repositoryRoot, contract), "utf8");
    assert.doesNotMatch(source, /\|\s*grep\s+[^\n]*q/);
  }
});

test("Node tool version failures report expected and actual versions", async () => {
  const source = await readFile(path.join(repositoryRoot, "images/node/contract.sh"), "utf8");
  assert.match(source, /Expected npm 11\.19\.1, got/);
  assert.match(source, /Expected npm tar 7\.5\.22, got/);
  assert.match(source, /Expected pnpm 10\.34\.5, got/);
  assert.match(source, /Expected pnpm tar 7\.5\.19, got/);
  assert.match(source, /Expected Yarn 4\.9\.2, got/);
  assert.match(source, /Node contract failed at line/);
  assert.match(source, /install --mode=skip-build/);
  assert.match(source, /runtime_command=\(yarn node\)/);
  assert.match(source, /YARN_ENABLE_GLOBAL_CACHE=false/);
});

test("PHP-family contracts report the command that failed", async () => {
  for (const contract of ["images/php/contract.sh", "images/wordpress/contract.sh"]) {
    const source = await readFile(path.join(repositoryRoot, contract), "utf8");
    assert.match(source, /contract failed at line/);
    assert.match(source, /xdebug_info\("mode"\) === \[\]/);
    assert.doesNotMatch(source, /ini_get\("xdebug\.mode"\)/);
  }
});

test("WordPress version probe searches for the literal PHP variable", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "images/wordpress/contract.sh"),
    "utf8"
  );
  assert.match(source, /'\$wp_version = '/);
  assert.doesNotMatch(source, /'\\\$wp_version = '/);
});

test("WordPress contract removes container-owned fixtures inside the Podman user namespace", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "images/wordpress/contract.sh"),
    "utf8"
  );
  assert.match(source, /podman unshare rm -rf -- "\$\{test_directory\}"/);
  assert.doesNotMatch(source, /^\s*rm -rf "\$\{test_directory\}"/m);
});

test("PHP entrypoint authorizes a custom Apache document root", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "images/php/docker-entrypoint-loom"),
    "utf8"
  );
  assert.match(source, /<Directory \"%s\">/);
  assert.match(source, /Require all granted/);
  assert.match(source, /conf-enabled\/zz-loom-document-root\.conf/);
});

test("Bun contract requires the patched Debian GnuTLS package", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "images/bun/1/contract.sh"),
    "utf8"
  );
  assert.match(source, /3\.7\.9-2\+deb12u7/);
  assert.match(source, /dpkg --compare-versions/);
});


test("exact runtime contract probes accept catalog versions and reject other versions", async () => {
  const catalog = JSON.parse(await readFile(path.join(repositoryRoot, "images/catalog.json"), "utf8"));
  const execute = promisify(execFile);
  const directory = await mkdtemp(path.join(tmpdir(), "loom-version-contract-"));
  try {
    const podman = path.join(directory, "podman");
    await writeFile(podman, `#!/bin/sh\nprintf '%s\\n' "$LOOM_CONTRACT_VERSION"\n`);
    await chmod(podman, 0o755);
    for (const [name, command, suffix] of [
      ["loom-bun-1", "bun", ""],
      ["loom-dotnet-8", "dotnet", ""],
      ["loom-sqlite-3", "sqlite3", " test-build"]
    ]) {
      const image = catalog.images.find((candidate) => candidate.name === name);
      const version = image.version.match(/^(\d+\.\d+\.\d+)/)[1];
      const contract = await readFile(path.join(repositoryRoot, image.context, "contract.sh"), "utf8");
      const probe = contract.replace(/\\\r?\n\s*/g, " ").split("\n")
        .find((line) => line.includes(`${command} --version`));
      assert.ok(probe, `${name} must check its runtime version`);
      const errorTrap = contract.split("\n").find((line) => line.startsWith("trap ") && line.endsWith(" ERR"));
      assert.ok(errorTrap, `${name} must report the failing contract command`);
      const runProbe = (value) => execute("bash", ["--noprofile", "--norc", "-c", `set -Eeuo pipefail\n${errorTrap}\nimage_reference=contract-test\n${probe}`], {
        env: { ...process.env, BASH_ENV: "/dev/null", PATH: `${directory}${path.delimiter}${process.env.PATH}`, LOOM_CONTRACT_VERSION: `${value}${suffix}` }
      });
      await runProbe(version);
      await assert.rejects(runProbe("0.0.0"), (error) => {
        assert.match(error.stderr, /0\.0\.0/);
        assert.match(error.stderr, /contract failed at line/);
        assert.match(error.stderr, /grep/);
        return true;
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
