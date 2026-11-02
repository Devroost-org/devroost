import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isCleanConfirmed } from "./clean-prompt.js";
import { doctorExitCode, formatDoctorJson, formatDoctorResults } from "./doctor-output.js";

function runCli(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) {
  const currentFileDir = dirname(fileURLToPath(import.meta.url));
  const cliPath = resolve(currentFileDir, "index.js");
  const captureDir = mkdtempSync(join(tmpdir(), "loom-cli-output-"));
  const stdoutPath = join(captureDir, "stdout");
  const stderrPath = join(captureDir, "stderr");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");

  try {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      encoding: "utf8",
      input: options.input,
      env: { ...process.env, ...options.env },
      stdio: [options.input === undefined ? "ignore" : "pipe", stdoutFd, stderrFd]
    });
    closeSync(stdoutFd);
    closeSync(stderrFd);

    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8")
    };
  } finally {
    try {
      closeSync(stdoutFd);
    } catch {
      // already closed after a successful spawn
    }
    try {
      closeSync(stderrFd);
    } catch {
      // already closed after a successful spawn
    }
    rmSync(captureDir, { recursive: true, force: true });
  }
}

test("logs reports unknown service with suggestion and available services", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "loom-cli-logs-"));
  const configPath = join(tempRoot, "devroost.yaml");
  await writeFile(
    configPath,
    [
      "version: 1",
      "name: ux-test",
      "runtime:",
      "  engine: podman",
      "  rootless: true",
      "services:",
      "  app:",
      "    type: node",
      "    image: node:20-alpine"
    ].join("\n"),
    "utf8"
  );

  const result = runCli(["logs", "ap", "--config", configPath, "--no-follow"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /Service 'ap' is not defined/i);
  assert.match(result.stderr || result.stdout, /Did you mean 'app'\?/i);
  assert.match(result.stderr || result.stdout, /Available services: app/i);
});

test("exec reports unknown service with suggestion", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "loom-cli-exec-"));
  const configPath = join(tempRoot, "devroost.yaml");
  await writeFile(
    configPath,
    [
      "version: 1",
      "name: ux-test",
      "runtime:",
      "  engine: podman",
      "  rootless: true",
      "services:",
      "  app:",
      "    type: node",
      "    image: node:20-alpine"
    ].join("\n"),
    "utf8"
  );

  const result = runCli(["exec", "ap", "--config", configPath, "--", "echo", "hello"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /Service 'ap' is not defined/i);
  assert.match(result.stderr || result.stdout, /Did you mean 'app'\?/i);
});

test("help includes the restore command", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /restore <service> <input>/i);
  assert.match(result.stdout, /upgrade/i);
  assert.match(result.stdout, /doctor/i);
  assert.match(result.stdout, /clean/i);
});

test("doctor human output is deterministic and exit semantics distinguish warnings from failures", () => {
  const warnings = [
    { id: "manifest", status: "pass" as const, summary: "Manifest current" },
    { id: "hosts", status: "warning" as const, summary: "Hosts unavailable", detail: "Use localhost." }
  ];
  assert.equal(formatDoctorResults(warnings), "[PASS] manifest: Manifest current\n[WARN] hosts: Hosts unavailable — Use localhost.\n");
  assert.equal(doctorExitCode(warnings), 0);
  assert.equal(doctorExitCode([...warnings, { id: "podman", status: "failure", summary: "Podman unavailable" }]), 1);
  assert.deepEqual(JSON.parse(formatDoctorJson(warnings)), warnings);
});

test("doctor CLI emits all ordered checks as JSON and matching human output", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-doctor-"));
  const initialized = runCli(["init", "node", "--dir", projectRoot]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const command = ["doctor", "--config", join(projectRoot, "devroost.yaml")];

  const jsonResult = runCli([...command, "--json"]);
  assert.equal(jsonResult.stderr, "");
  const results = JSON.parse(jsonResult.stdout) as Array<{ id: string; status: "pass" | "warning" | "failure" }>;
  assert.deepEqual(results.map(({ id }) => id), [
    "manifest", "images", "podman", "architecture", "lockfiles", "dependencies", "ports", "routes", "hosts"
  ]);
  assert.equal(jsonResult.status, results.some(({ status }) => status === "failure") ? 1 : 0);

  const humanResult = runCli(command);
  assert.equal(humanResult.stderr, "");
  const lines = humanResult.stdout.trimEnd().split("\n");
  assert.equal(lines.length, results.length);
  const label = { pass: "PASS", warning: "WARN", failure: "FAIL" } as const;
  for (const [index, result] of results.entries()) {
    assert.match(lines[index]!, new RegExp(`^\\[${label[result.status]}\\] ${result.id}:`));
  }
});

test("clean previews exact sorted paths and dry-run never deletes", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-clean-"));
  const initialized = runCli(["init", "node", "--dir", projectRoot]);
  assert.equal(initialized.status, 0, initialized.stderr);
  await mkdir(join(projectRoot, "dist"));
  await writeFile(join(projectRoot, "dist", "app.js"), "build\n");

  const result = runCli(["clean", "--config", join(projectRoot, "devroost.yaml"), "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, / {2}dist \[build\] 6 B\n {2}node_modules \[dependency\] missing\nTotal: 6 B/);
  assert.equal(await readFile(join(projectRoot, "dist", "app.js"), "utf8"), "build\n");
});

test("clean confirmation accepts only explicit yes answers", () => {
  for (const answer of ["y", "Y", "yes", "YES", " yes "]) assert.equal(isCleanConfirmed(answer), true);
  for (const answer of ["", "n", "no", "yeah", "true"]) assert.equal(isCleanConfirmed(answer), false);
});

test("clean refuses non-interactive deletion without force and force removes only generated paths", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-clean-"));
  const initialized = runCli(["init", "node", "--dir", projectRoot]);
  assert.equal(initialized.status, 0, initialized.stderr);
  await mkdir(join(projectRoot, "dist"));
  await writeFile(join(projectRoot, "dist", "app.js"), "build\n");
  await writeFile(join(projectRoot, "keep.txt"), "keep\n");

  const refused = runCli(["clean", "--config", join(projectRoot, "devroost.yaml")]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /Generated paths:/);
  assert.match(refused.stderr, /--force/);
  assert.equal(await readFile(join(projectRoot, "dist", "app.js"), "utf8"), "build\n");

  const forced = runCli(["clean", "--config", join(projectRoot, "devroost.yaml"), "--force"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /Cleanup complete: 1 removed, 1 missing/);
  await assert.rejects(readFile(join(projectRoot, "dist", "app.js"), "utf8"));
  assert.equal(await readFile(join(projectRoot, "keep.txt"), "utf8"), "keep\n");
});

test("clean rejects an unsafe plan before deleting any generated path", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-clean-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "loom-cli-clean-outside-"));
  const initialized = runCli(["init", "node", "--dir", projectRoot]);
  assert.equal(initialized.status, 0, initialized.stderr);
  await mkdir(join(projectRoot, "dist"));
  await writeFile(join(projectRoot, "dist", "app.js"), "retain\n");
  await symlink(outsideRoot, join(projectRoot, "node_modules"));

  const result = runCli(["clean", "--config", join(projectRoot, "devroost.yaml"), "--force"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symlink/i);
  assert.equal(result.stdout, "");
  assert.equal(await readFile(join(projectRoot, "dist", "app.js"), "utf8"), "retain\n");
});

test("upgrade reports a missing manifest", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-upgrade-"));
  const result = runCli(["upgrade", "--config", join(projectRoot, "devroost.yaml")]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No Devroost project manifest/i);
});

test("upgrade migrates v1 baselines without replacing project files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-upgrade-"));
  const devroostYaml = "version: 1\nname: retained-name\nservices: {}\n";
  await mkdir(join(projectRoot, ".devroost"), { recursive: true });
  await writeFile(join(projectRoot, "devroost.yaml"), devroostYaml);
  await writeFile(join(projectRoot, ".devroost", "manifest.json"), JSON.stringify({
    version: 1,
    devroostVersion: "0.1.0",
    stack: { id: "node", scaffoldVersion: "1" },
    ownedFiles: { "devroost.yaml": { sha256: "old" } }
  }));

  const refused = runCli(["upgrade", "--config", join(projectRoot, "devroost.yaml")]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /--initialize-baseline/);
  assert.equal(await readFile(join(projectRoot, "devroost.yaml"), "utf8"), devroostYaml);

  const migrated = runCli(["upgrade", "--config", join(projectRoot, "devroost.yaml"), "--initialize-baseline"]);
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.match(migrated.stdout, /No project files were replaced/);
  assert.equal(await readFile(join(projectRoot, "devroost.yaml"), "utf8"), devroostYaml);
  const manifest = JSON.parse(await readFile(join(projectRoot, ".devroost", "manifest.json"), "utf8")) as {
    version: number;
    stack: { definitionVersion: number };
    renderInputs: { projectName: string };
  };
  assert.equal(manifest.version, 2);
  assert.equal(manifest.stack.definitionVersion, 2);
  assert.equal(manifest.renderInputs.projectName, "retained-name");
});

test("upgrade rejects an unknown manifest stack", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-upgrade-"));
  await mkdir(join(projectRoot, ".devroost"), { recursive: true });
  await writeFile(join(projectRoot, ".devroost", "manifest.json"), JSON.stringify({
    version: 1,
    devroostVersion: "0.1.0",
    stack: { id: "not-a-stack", scaffoldVersion: "1" },
    ownedFiles: {}
  }));
  const result = runCli(["upgrade", "--config", join(projectRoot, "devroost.yaml")]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown stack 'not-a-stack'/);
});

test("upgrade skips modified Devroost files unless forced and preserves developer files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "loom-cli-upgrade-"));
  const initialized = runCli(["init", "node", "--dir", projectRoot]);
  assert.equal(initialized.status, 0, initialized.stderr);

  const configPath = join(projectRoot, "devroost.yaml");
  const originalLoom = await readFile(configPath, "utf8");
  const current = runCli(["upgrade", "--config", configPath]);
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /unchanged devroost\.yaml -> already current/);

  const modifiedLoom = `${originalLoom}\n# local Devroost edit\n`;
  const developerFiles: Record<string, string> = {
    "package.json": '{"private":true}\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    ".env": "SECRET=keep-me\n"
  };
  await writeFile(configPath, modifiedLoom);
  for (const [path, contents] of Object.entries(developerFiles)) await writeFile(join(projectRoot, path), contents);

  const refused = runCli(["upgrade", "--config", configPath]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout, /modified devroost\.yaml -> skipped/);
  assert.equal(await readFile(configPath, "utf8"), modifiedLoom);

  const forced = runCli(["upgrade", "--config", configPath, "--force-modified"]);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /modified devroost\.yaml -> update available/);
  assert.equal(await readFile(configPath, "utf8"), originalLoom);
  for (const [path, contents] of Object.entries(developerFiles)) {
    assert.equal(await readFile(join(projectRoot, path), "utf8"), contents);
  }
});
