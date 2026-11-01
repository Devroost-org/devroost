import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLocalCertificates } from "./index.js";

test("certificates are reused when valid and renewed for new hosts or invalid keys", async (context) => {
  const previous = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "loom-certificate-test-"));
  try {
    process.chdir(root);
    const paths = await ensureLocalCertificates("demo", ["demo.test"]);
    const first = await readFile(paths.certPath, "utf8");
    await ensureLocalCertificates("demo", ["demo.test"]);
    assert.equal(await readFile(paths.certPath, "utf8"), first);
    await ensureLocalCertificates("demo", ["demo.test", "api.demo.test"]);
    const expanded = await readFile(paths.certPath, "utf8");
    assert.notEqual(expanded, first);
    assert.equal(new X509Certificate(expanded).checkHost("api.demo.test"), "api.demo.test");
    await writeFile(paths.keyPath, "invalid private key");
    await ensureLocalCertificates("demo", ["demo.test", "api.demo.test"]);
    assert.notEqual(await readFile(paths.keyPath, "utf8"), "invalid private key");
    const repaired = await readFile(paths.certPath, "utf8");
    assert.notEqual(repaired, expanded);
    const afterExpiry = Date.parse(new X509Certificate(repaired).validTo) + 1;
    const clock = context.mock.method(Date, "now", () => afterExpiry);
    await ensureLocalCertificates("demo", ["demo.test", "api.demo.test"]);
    clock.mock.restore();
    assert.notEqual(await readFile(paths.certPath, "utf8"), repaired);
  } finally {
    process.chdir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
