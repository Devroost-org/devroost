import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRouteProxy, stopRouteProxy, type ProxyDependencies } from "./index.js";
import type { LoomConfig } from "@loom/config";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-proxy-test-"));
  const stateDir = join(root, "shared");
  const certPath = join(root, "cert");
  const keyPath = join(root, "key");
  await writeFile(certPath, "certificate");
  await writeFile(keyPath, "key");
  const commands: string[][] = [];
  let exists = false;
  let running = true;
  let version = "2";
  const networks = new Set<string>();
  const dependencies: ProxyDependencies = {
    stateDir,
    runPodmanCommand: async (args) => {
      commands.push(args);
      let stdout = "";
      let ok = true;
      if (args[0] === "container") ok = exists;
      if (args[0] === "inspect") {
        if (args[2]!.includes("Labels")) stdout = version;
        else if (args[2]!.includes("Networks")) stdout = JSON.stringify(Object.fromEntries([...networks].map((name) => [name, {}])));
        else stdout = String(running);
      }
      if (args[0] === "run") { exists = true; networks.add(args[args.indexOf("--network") + 1]!); }
      if (args[0] === "network") networks.add(args[2]!);
      if (args[0] === "rm") exists = false;
      if (args[0] === "start") running = true;
      return { ok, stdout, stderr: "", code: ok ? 0 : 1 };
    }
  };
  const start = (name: string) => ensureRouteProxy(
    { name } as LoomConfig,
    [{ host: `${name}.test`, service: "web", targetPort: 3000, externalPort: 3000, https: true }],
    { certPath, keyPath }, `loom-${name}`, 8080, 8443, dependencies
  );
  return { root, stateDir, commands, dependencies, start, setVersion(value: string) { exists = true; version = value; }, setStopped() { running = false; } };
}

test("shared proxy imports only snippets and serves two projects on their own networks", async () => {
  const f = await fixture();
  try {
    await f.start("one");
    await f.start("two");
    const main = await readFile(join(f.stateDir, "Caddyfile"), "utf8");
    assert.match(main, /import \/etc\/caddy\/sites\/\*\.Caddyfile/);
    assert.doesNotMatch(main, /sites\/\*\n/);
    for (const name of ["one", "two"]) {
      const snippet = await readFile(join(f.stateDir, `${name}.Caddyfile`), "utf8");
      assert.ok(snippet.includes(`reverse_proxy ${name}-web:3000`));
      assert.ok(snippet.includes(`/certs/${name}.key`));
      assert.equal(await readFile(join(f.stateDir, "certs", `${name}.key`), "utf8"), "key");
    }
    assert.equal(f.commands.filter((args) => args[0] === "run").length, 1);
    assert.ok(f.commands.some((args) => args.join(" ") === "network connect loom-two loom-proxy"));
    assert.ok(f.commands.some((args) => args[0] === "exec" && args.includes("reload")));
    await stopRouteProxy("one", f.dependencies);
    await assert.rejects(readFile(join(f.stateDir, "one.Caddyfile")), { code: "ENOENT" });
    assert.ok(await readFile(join(f.stateDir, "two.Caddyfile"), "utf8"));
    assert.equal(f.commands.filter((args) => args[0] === "exec").length, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("proxy migrates the legacy mount layout and restarts a stopped container", async () => {
  const f = await fixture();
  try {
    f.setVersion("");
    await f.start("one");
    assert.ok(f.commands.some((args) => args.join(" ") === "rm -f loom-proxy"));
    assert.ok(f.commands.some((args) => args.includes(`${f.stateDir}:/etc/caddy/sites:ro`)));
    f.setVersion("2");
    f.setStopped();
    await f.start("one");
    assert.ok(f.commands.some((args) => args.join(" ") === "start loom-proxy"));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("proxy does not claim success when a reload fails", async () => {
  const f = await fixture();
  try {
    await f.start("one");
    const run = f.dependencies.runPodmanCommand!;
    f.dependencies.runPodmanCommand = async (args) => args[0] === "exec"
      ? { ok: false, stdout: "", stderr: "invalid config", code: 1 }
      : run(args);
    await assert.rejects(f.start("two"), /invalid config/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
