import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const stacksRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.includes("/dist/") ? ".." : ".");
type Response = { writeHead(status: number): void; end(body: unknown): void };
type Request = { url: string; method?: string; headers?: object; pipe?: (stream: unknown) => void };
type Handler = (request: Request, response: Response) => void;

async function loadServer(template: string, directory: string, onProxy: (url: URL) => void = () => {}): Promise<Handler> {
  let handler: Handler | undefined;
  const http = {
    createServer(callback: Handler) { handler = callback; return { listen() {} }; },
    request(url: URL) { onProxy(url); return { on() {} }; }
  };
  const source = (await readFile(path.join(stacksRoot, template), "utf8"))
    .replace(/^import .*;$/gm, "")
    .replace("import.meta.url", '"file:///test/server.js"');
  vm.runInNewContext(source, {
    fs, http, path, URL,
    __dirname: directory,
    fileURLToPath: () => path.join(directory, "server.js"),
    require: (id: string) => ({ "node:fs": fs, "node:http": http, "node:path": path })[id],
    process: { env: {}, stdout: { write() {} } }
  });
  assert.ok(handler);
  return handler;
}

function request(handler: Handler, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    let status = 0;
    handler({ url }, { writeHead(value) { status = value; }, end(body) { resolve({ status, body: String(body) }); } });
  });
}

test("Spring React serves public assets but refuses traversal and escaping symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "loom-static-security-"));
  try {
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "index.html"), "public");
    await writeFile(path.join(root, "secret.txt"), "private");
    await symlink(path.join(root, "secret.txt"), path.join(root, "dist", "linked.txt"));
    const handler = await loadServer("spring-react/templates/frontend/server.js", root);
    assert.deepEqual(await request(handler, "/"), { status: 200, body: "public" });
    assert.deepEqual(await request(handler, "/index.html?v=1"), { status: 200, body: "public" });
    for (const url of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/linked.txt", "/%", "/missing.txt"]) {
      assert.deepEqual(await request(handler, url), { status: 404, body: "Not found" }, url);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serverless proxy refuses origin overrides while preserving normal API requests", async () => {
  const targets: string[] = [];
  const handler = await loadServer("serverless/templates/web-server.js", "/unused", (url) => targets.push(url.href));
  for (const url of ["/api//127.0.0.1:45678/private", "/api/\\evil.example/private", "/api//evil.example/private"]) {
    assert.equal((await request(handler, url)).status, 400, url);
  }
  assert.deepEqual(targets, []);
  handler({ url: "/api/feed?limit=5", method: "GET", headers: {}, pipe() {} }, { writeHead() {}, end() {} });
  assert.deepEqual(targets, ["http://127.0.0.1:3007/feed?limit=5"]);
});

test("Elasticsearch development ports are explicitly restricted to loopback", async () => {
  for (const stack of ["db-elasticsearch", "db-all"]) {
    const yaml = await readFile(path.join(stacksRoot, stack, "templates/loom.yaml"), "utf8");
    for (const port of [9200, 9300]) {
      assert.ok(yaml.includes(`"127.0.0.1:${port}:${port}"`));
      assert.ok(!yaml.includes(`"${port}:${port}"`));
    }
  }
});
