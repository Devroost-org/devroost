import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateSecurityExceptions } from "./security-policy.mjs";

const now = new Date("2026-09-01T00:00:00Z");
const finding = { id: "CVE-2026-1000", fixedVersion: "1.2.3" };
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("accepts a documented active exception for a reported finding", () => {
  assert.deepEqual(
    validateSecurityExceptions([
      {
        id: finding.id,
        rationale: "Upstream rebuild is pending and exposure is not reachable.",
        owner: "@loom-security",
        expires: "2026-09-15"
      }
    ], now, [finding]),
    []
  );
});

test("accepts an exception expiring exactly 30 days from now", () => {
  assert.deepEqual(
    validateSecurityExceptions([
      {
        id: finding.id,
        rationale: "Upstream rebuild is pending.",
        owner: "@loom-security",
        expires: "2026-10-01"
      }
    ], now, [finding]),
    []
  );
});

test("rejects incomplete, expired, overlong, and stale exceptions", () => {
  assert.match(
    validateSecurityExceptions([
      { id: "CVE-1", rationale: "", owner: "", expires: "2026-09-15" },
      { id: "CVE-2", rationale: "Temporary", owner: "@owner", expires: "2026-08-31" },
      { id: "CVE-3", rationale: "Temporary", owner: "@owner", expires: "2026-10-02" },
      { id: "CVE-4", rationale: "Temporary", owner: "@owner", expires: "2026-09-15" }
    ], now, []).join("\n"),
    /rationale.*owner.*expired.*30 days.*not present/s
  );
});

test("rejects a fixable critical finding without an exception", () => {
  assert.deepEqual(
    validateSecurityExceptions([], now, [finding]),
    ["fixable critical vulnerability CVE-2026-1000 (fixed in 1.2.3) is not excepted"]
  );
});

test("reports the vulnerable package and upgrade path", () => {
  const detailedFinding = {
    ...finding,
    target: "usr/local/bin/example",
    packageName: "stdlib",
    installedVersion: "1.20.1"
  };

  assert.deepEqual(
    validateSecurityExceptions([], now, [detailedFinding]),
    [
      "fixable critical vulnerability CVE-2026-1000 in usr/local/bin/example:stdlib (1.20.1 -> 1.2.3) is not excepted"
    ]
  );
});

test("scopes an exception to its vulnerable target and package", () => {
  const exception = {
    id: finding.id,
    target: "usr/local/bin/gosu",
    packageName: "stdlib",
    rationale: "The affected TLS code is unreachable in gosu.",
    owner: "@loom-security",
    expires: "2026-09-15"
  };
  const gosuFinding = {
    ...finding,
    target: "usr/local/bin/gosu",
    packageName: "stdlib"
  };
  const serverFinding = {
    ...finding,
    target: "usr/local/bin/server",
    packageName: "stdlib"
  };

  assert.deepEqual(validateSecurityExceptions([exception], now, [gosuFinding]), []);
  assert.deepEqual(validateSecurityExceptions([exception], now, []), []);
  assert.match(
    validateSecurityExceptions([exception], now, [gosuFinding, serverFinding]).join("\n"),
    /in usr\/local\/bin\/server:stdlib/
  );
});

test("unrelated expired scoped exceptions do not fail a clean image scan", () => {
  const exception = {
    id: finding.id,
    target: "usr/local/bin/gosu",
    packageName: "stdlib",
    rationale: "The affected TLS code is unreachable in gosu.",
    owner: "@loom-security",
    expires: "2026-08-31"
  };
  assert.deepEqual(validateSecurityExceptions([exception], now, []), []);
  assert.deepEqual(validateSecurityExceptions([exception], now, [{
    ...finding, target: "usr/local/bin/another-binary", packageName: "stdlib"
  }]), ["fixable critical vulnerability CVE-2026-1000 in usr/local/bin/another-binary:stdlib (fixed in 1.2.3) is not excepted"]);
});

test("matching findings still fail when their scoped exception has expired", () => {
  const exception = {
    id: finding.id,
    target: "usr/local/bin/gosu",
    packageName: "stdlib",
    rationale: "The affected TLS code is unreachable in gosu.",
    owner: "@loom-security",
    expires: "2026-08-31"
  };
  assert.deepEqual(validateSecurityExceptions([exception], now, [{
    ...finding, target: exception.target, packageName: exception.packageName
  }]), ["CVE-2026-1000 exception is expired"]);
});

test("CLI exposes vulnerability details as GitHub Actions annotations", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const directory = await mkdtemp(path.join(tmpdir(), "loom-policy-annotation-"));
  try {
    const exceptions = path.join(directory, "exceptions.json");
    const report = path.join(directory, "report.json");
    await writeFile(exceptions, "[]");
    await writeFile(report, JSON.stringify({ Results: [{
      Target: "usr/bin/example", Vulnerabilities: [{
        VulnerabilityID: "CVE-2026-1000", Severity: "CRITICAL",
        PkgName: "example", InstalledVersion: "1.0", FixedVersion: "1.1"
      }]
    }] }));
    await assert.rejects(promisify(execFile)(process.execPath, [
      path.join(repositoryRoot, "scripts/images/security-policy.mjs"), exceptions, report
    ], { env: { ...process.env, GITHUB_ACTIONS: "true" }, stdio: "pipe" }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr.toString(), /::error::fixable critical vulnerability CVE-2026-1000 in usr\/bin\/example:example \(1.0 -> 1.1\) is not excepted/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reviewed gosu exception remains narrow and expires within 30 days", async () => {
  const exceptions = JSON.parse(await readFile(path.join(repositoryRoot, "images/security-exceptions.json"), "utf8"));
  const gosu = { id: "CVE-2025-68121", target: "usr/local/bin/gosu", packageName: "stdlib", fixedVersion: "1.24.13" };
  assert.deepEqual(validateSecurityExceptions(exceptions, new Date("2026-11-01T00:00:00Z"), [gosu]), []);
  assert.match(validateSecurityExceptions(exceptions, new Date("2026-12-01T00:00:00Z"), [gosu]).join("\n"), /expired/);
  assert.match(validateSecurityExceptions(exceptions, new Date("2026-11-01T00:00:00Z"), [{ ...gosu, target: "usr/bin/server" }]).join("\n"), /not excepted/);
});
