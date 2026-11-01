import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;

function expiryDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

export function validateSecurityExceptions(entries, now, findings = []) {
  const exceptions = Array.isArray(entries) ? entries : [];
  const currentTime = now instanceof Date ? now : new Date(now);
  const errors = [];
  const matchesException = (entry, finding) =>
    entry?.id === finding?.id &&
    (!entry.target || entry.target === finding.target) &&
    (!entry.packageName || entry.packageName === finding.packageName);

  for (const entry of exceptions) {
    const label = entry?.id || "exception without an id";
    if (!entry?.id) errors.push(`${label} must include an id`);
    if (!entry?.rationale?.trim()) errors.push(`${label} must include a rationale`);
    if (!entry?.owner?.trim()) errors.push(`${label} must include an owner`);
    if (!expiryDate(entry?.expires)) errors.push(`${label} must include a valid expires date`);
  }

  for (const entry of exceptions) {
    // A shared exception file covers many images. Expiry applies only to a
    // scoped exception used by this report; matching expired waivers still fail.
    const isScoped = entry?.target || entry?.packageName;
    if (isScoped && !findings.some((finding) => matchesException(entry, finding))) continue;
    const expires = expiryDate(entry?.expires);
    if (!expires) continue;

    const expiresAtEndOfDay = new Date(expires.getTime() + DAY_MS - 1);
    if (expiresAtEndOfDay < currentTime) {
      errors.push(`${entry.id} exception is expired`);
    } else if (expires.getTime() - currentTime.getTime() > 30 * DAY_MS) {
      errors.push(`${entry.id} exception may not extend more than 30 days`);
    }
  }

  for (const entry of exceptions) {
    const isScoped = entry?.target || entry?.packageName;
    if (entry?.id && !isScoped && !findings.some((finding) => matchesException(entry, finding))) {
      errors.push(`${entry.id} exception is not present in the vulnerability report`);
    }
  }

  for (const finding of findings) {
    if (finding?.id && !exceptions.some((entry) => matchesException(entry, finding))) {
      const location = [finding.target, finding.packageName].filter(Boolean).join(":");
      const versions = finding.installedVersion
        ? ` (${finding.installedVersion} -> ${finding.fixedVersion})`
        : ` (fixed in ${finding.fixedVersion})`;
      errors.push(
        `fixable critical vulnerability ${finding.id}${location ? ` in ${location}` : ""}${versions} is not excepted`
      );
    }
  }

  return errors;
}

export function extractFixableCriticalFindings(report) {
  return (report?.Results ?? [])
    .flatMap(({ Target, Vulnerabilities = [] }) =>
      Vulnerabilities.map((vulnerability) => ({ ...vulnerability, Target })))
    .filter(({ Severity, FixedVersion }) => Severity === "CRITICAL" && FixedVersion)
    .map(({ VulnerabilityID, FixedVersion, InstalledVersion, PkgName, Target }) => ({
      id: VulnerabilityID,
      fixedVersion: FixedVersion,
      installedVersion: InstalledVersion,
      packageName: PkgName,
      target: Target
    }));
}

function run(argv) {
  const [exceptionsPath, reportPath] = argv;
  if (!exceptionsPath || !reportPath) {
    throw new Error("usage: security-policy.mjs <exceptions.json> <trivy-report.json>");
  }

  const exceptions = JSON.parse(fs.readFileSync(exceptionsPath, "utf8"));
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const errors = validateSecurityExceptions(
    exceptions,
    new Date(),
    extractFixableCriticalFindings(report)
  );

  if (errors.length > 0) {
    if (process.env.GITHUB_ACTIONS === "true") {
      for (const error of errors) {
        const annotation = error.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
        process.stderr.write(`::error::${annotation}\n`);
      }
    }
    throw new Error(errors.join("\n"));
  }

  process.stdout.write("Image vulnerability policy passed.\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
