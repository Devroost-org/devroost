import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { constants } from "node:fs";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { spawn } from "node:child_process";

export interface CertificatePaths {
  certPath: string;
  keyPath: string;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      reject(new Error(`Failed to run ${command}.`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 1}`));
    });
  });
}

export async function ensureLocalCertificates(projectName: string, hosts: string[]): Promise<CertificatePaths> {
  const certDir = resolve(process.cwd(), ".devroost", "certs");
  await mkdir(certDir, { recursive: true });

  const certPath = resolve(certDir, `${projectName}.crt`);
  const keyPath = resolve(certDir, `${projectName}.key`);

  try {
    await access(certPath, constants.F_OK);
    await access(keyPath, constants.F_OK);
    const certificate = new X509Certificate(await readFile(certPath));
    const now = Date.now();
    const coversHosts = hosts.every((host) => certificate.checkHost(host, { subject: "never" }));
    const valid = Date.parse(certificate.validFrom) <= now && Date.parse(certificate.validTo) > now + 86_400_000;
    const matchesKey = certificate.checkPrivateKey(createPrivateKey(await readFile(keyPath)));
    if (!coversHosts || !valid || !matchesKey) throw new Error("Certificate needs renewal");
    return { certPath, keyPath };
  } catch {
    const configPath = resolve(certDir, `${projectName}.openssl.cnf`);
    const uniqueHosts = Array.from(new Set(hosts.length ? hosts : [`${projectName}.devroost.local`]));
    const sanEntries = uniqueHosts.map((host, index) => `DNS.${index + 1} = ${host}`).join("\n");

    const opensslConfig = `[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = ${projectName}.devroost.local

[v3_req]
subjectAltName = @alt_names

[alt_names]
${sanEntries}
`;

    await writeFile(configPath, opensslConfig, "utf-8");

    await run("openssl", [
      "req",
      "-x509",
      "-nodes",
      "-days",
      "365",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-config",
      configPath,
      "-extensions",
      "v3_req"
    ]);

    return { certPath, keyPath };
  }
}
