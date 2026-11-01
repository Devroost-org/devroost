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

test("MongoDB Database Tools exceptions cover only the reported binaries", async () => {
  const exceptions = JSON.parse(await readFile(
    path.join(repositoryRoot, "images/security-exceptions.json"),
    "utf8"
  ));
  const targets = [
    "usr/bin/bsondump",
    "usr/bin/mongodump",
    "usr/bin/mongoexport",
    "usr/bin/mongofiles",
    "usr/bin/mongoimport",
    "usr/bin/mongorestore",
    "usr/bin/mongostat",
    "usr/bin/mongotop"
  ];
  const findings = targets.map((target) => ({
    id: "CVE-2026-56854",
    target,
    packageName: "golang.org/x/crypto",
    installedVersion: "v0.54.0",
    fixedVersion: "0.55.0"
  }));

  assert.deepEqual(
    validateSecurityExceptions(exceptions, new Date("2026-09-02T00:00:00Z"), findings),
    []
  );
  assert.equal(
    exceptions.filter(({ id }) => id === "CVE-2026-56854").every(({ target, packageName }) =>
      targets.includes(target) && packageName === "golang.org/x/crypto"),
    true
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
