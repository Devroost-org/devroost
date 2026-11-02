import assert from "node:assert/strict";
import test from "node:test";
import type { DevroostConfig } from "@devroost/config";
import { publishConfiguredRoutes, type RouteBinding } from "./routes.js";

function createConfig(): DevroostConfig {
  return {
    version: 1,
    name: "demo",
    runtime: { engine: "podman", rootless: true },
    services: {
      app: { type: "node", image: "node:20-alpine" }
    }
  };
}

test("publishConfiguredRoutes removes stale proxy and hosts when no routes remain", async () => {
  const removed: string[] = [];
  let proxyCalls = 0;
  let certificateCalls = 0;
  const lines: string[] = [];

  await publishConfiguredRoutes(
    createConfig(),
    [],
    "demo-net",
    {
      stopRouteProxy: async (name) => { removed.push(`proxy:${name}`); },
      stopRouteHosts: async (name) => { removed.push(`hosts:${name}`); },
      ensureLocalCertificates: async () => {
        certificateCalls += 1;
        return { certPath: "/tmp/cert.pem", keyPath: "/tmp/key.pem" };
      },
      ensureRouteHosts: async () => ({ managedHosts: [], skippedHosts: [] }),
      ensureRouteProxy: async () => {
        proxyCalls += 1;
        return { containerName: "devroost-proxy", httpPort: 8080, httpsPort: 8443 };
      }
    },
    {
      writeOut(message) {
        lines.push(message);
      },
      writeErr() {
        // no-op
      }
    }
  );

  assert.deepEqual(removed, ["proxy:demo", "hosts:demo"]);
  assert.equal(proxyCalls, 0);
  assert.equal(certificateCalls, 0);
  assert.deepEqual(lines, []);
});

test("publishConfiguredRoutes configures proxy and writes route and https summaries", async () => {
  const certificateHosts: string[][] = [];
  const proxyCalls: Array<{ bindings: RouteBinding[]; networkName: string }> = [];
  const lines: string[] = [];

  await publishConfiguredRoutes(
    createConfig(),
    [
      {
        host: "demo.test",
        service: "app",
        targetPort: 3000,
        externalPort: 8080,
        https: true
      },
      {
        host: "plain.demo.test",
        service: "app",
        targetPort: 3000,
        externalPort: 8081,
        https: false
      }
    ],
    "demo-net",
    {
      stopRouteProxy: async () => {},
      stopRouteHosts: async () => {},
      ensureLocalCertificates: async (_projectName, hosts) => {
        certificateHosts.push(hosts);
        return { certPath: "/tmp/cert.pem", keyPath: "/tmp/key.pem" };
      },
      ensureRouteHosts: async () => ({ managedHosts: [], skippedHosts: [] }),
      ensureRouteProxy: async (_config, bindings, _certificateInfo, networkName) => {
        proxyCalls.push({ bindings, networkName });
        return { containerName: "devroost-proxy", httpPort: 8080, httpsPort: 8443 };
      }
    },
    {
      writeOut(message) {
        lines.push(message);
      },
      writeErr() {
        // no-op
      }
    }
  );

  assert.deepEqual(certificateHosts, [["demo.test"]]);
  assert.deepEqual(proxyCalls, [
    {
      bindings: [
        {
          host: "demo.test",
          service: "app",
          targetPort: 3000,
          externalPort: 8080,
          https: true
        },
        {
          host: "plain.demo.test",
          service: "app",
          targetPort: 3000,
          externalPort: 8081,
          https: false
        }
      ],
      networkName: "demo-net"
    }
  ]);
  assert.deepEqual(lines, [
    "Route bindings:\n",
    "- https://demo.test:8443 -> app:3000 (direct: http://localhost:8080/)\n",
    "- http://plain.demo.test:8080 -> app:3000 (direct: http://localhost:8081/)\n",
    "Route proxy listener ports: http://localhost:8080 https://localhost:8443 (use with configured route hostnames)\n",
    "\n→ Open https://demo.test:8443 in your browser\n",
    "\n→ Open http://plain.demo.test:8080 in your browser\n",
    "HTTPS cert: /tmp/cert.pem\n",
    "HTTPS key: /tmp/key.pem\n"
  ]);
});

test("publishConfiguredRoutes prints /etc/hosts instructions when hosts could not be written", async () => {
  const lines: string[] = [];
  const errors: string[] = [];

  await publishConfiguredRoutes(
    createConfig(),
    [{ host: "demo.test", service: "app", targetPort: 3000, externalPort: 8080, https: true }],
    "demo-net",
    {
      stopRouteProxy: async () => {},
      stopRouteHosts: async () => {},
      ensureLocalCertificates: async () => ({ certPath: "/tmp/cert.pem", keyPath: "/tmp/key.pem" }),
      ensureRouteHosts: async () => ({ managedHosts: [], skippedHosts: [], pendingHosts: ["demo.test"] }),
      ensureRouteProxy: async () => ({ containerName: "devroost-proxy", httpPort: 8080, httpsPort: 8443 })
    },
    {
      writeOut(message) { lines.push(message); },
      writeErr(message) { errors.push(message); }
    }
  );

  assert.ok(lines.some((l) => l.includes("127.0.0.1 demo.test")));
  assert.ok(lines.some((l) => l.includes("/etc/hosts")));
});