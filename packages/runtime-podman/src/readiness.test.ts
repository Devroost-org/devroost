import test from "node:test";
import assert from "node:assert/strict";
import { waitForServiceReadyWithDependencies } from "./readiness.js";

test("waitForServiceReady accepts a healthy container", async () => {
  let calls = 0;

  await waitForServiceReadyWithDependencies(
    "demo",
    "app",
    { retries: 3, intervalSeconds: 1 },
    {
      inspectContainerByName: async () => {
        calls += 1;
        return {
          name: "demo-app",
          state: "running",
          running: true,
          health: calls === 2 ? "healthy" : "starting",
          image: "demo"
        };
      },
      sleep: async () => undefined,
      now: () => 0
    }
  );

  assert.equal(calls, 2);
});

test("waitForServiceReady requires two stable running checks when no explicit probe exists", async () => {
  let calls = 0;

  await waitForServiceReadyWithDependencies(
    "demo",
    "app",
    { retries: 3, intervalSeconds: 1 },
    {
      inspectContainerByName: async () => {
        calls += 1;
        return {
          name: "demo-app",
          state: "running",
          running: true,
          image: "demo"
        };
      },
      sleep: async () => undefined,
      now: () => 0
    }
  );

  assert.equal(calls, 2);
});

test("waitForServiceReady uses port reachability when ports are configured", async () => {
  let probeCalls = 0;

  await waitForServiceReadyWithDependencies(
    "demo",
    "app",
    { ports: ["8080:80"], retries: 2, intervalSeconds: 1 },
    {
      inspectContainerByName: async () => ({
        name: "demo-app",
        state: "running",
        running: true,
        image: "demo"
      }),
      arePortsReachable: async (ports) => {
        probeCalls += 1;
        assert.deepEqual(ports, [8080]);
        return true;
      },
      sleep: async () => undefined,
      now: () => 0
    }
  );

  assert.equal(probeCalls, 1);
});

test("waitForServiceReady rejects unhealthy containers", async () => {
  await assert.rejects(
    () =>
      waitForServiceReadyWithDependencies(
        "demo",
        "app",
        { retries: 1, intervalSeconds: 1 },
        {
          inspectContainerByName: async () => ({
            name: "demo-app",
            state: "running",
            running: true,
            health: "unhealthy",
            image: "demo"
          }),
          sleep: async () => undefined,
          now: () => 0
        }
      ),
    /reported unhealthy status/i
  );
});

test("waitForServiceReady does not sleep through the full startup grace period when the container becomes healthy early", async () => {
  let calls = 0;

  await waitForServiceReadyWithDependencies(
    "demo",
    "app",
    { retries: 3, intervalSeconds: 1, startPeriodSeconds: 300 },
    {
      inspectContainerByName: async () => {
        calls += 1;
        return {
          name: "demo-app",
          state: "running",
          running: true,
          health: "healthy",
          image: "demo"
        };
      },
      sleep: async () => undefined,
      now: () => 0
    }
  );

  assert.equal(calls, 1);
});

test("waitForServiceReady ignores unhealthy healthchecks during startup grace and reports progress", async () => {
  let calls = 0;
  let currentTime = 0;
  const progress: Array<{ elapsedSeconds: number; detail: string }> = [];

  await waitForServiceReadyWithDependencies(
    "demo",
    "app",
    { retries: 5, intervalSeconds: 5, startPeriodSeconds: 20, progressIntervalSeconds: 5, onProgress: (event) => progress.push(event) },
    {
      inspectContainerByName: async () => {
        calls += 1;
        return {
          name: "demo-app",
          state: "running",
          running: true,
          health: calls < 3 ? "unhealthy" : "healthy",
          image: "demo"
        };
      },
      sleep: async (ms) => {
        currentTime += ms;
      },
      now: () => currentTime
    }
  );

  assert.equal(calls, 3);
  assert.deepEqual(progress, [
    { elapsedSeconds: 0, detail: "healthcheck is still settling during startup grace period" },
    { elapsedSeconds: 5, detail: "healthcheck is still settling during startup grace period" }
  ]);
});

test("waitForServiceReady extends retry budget and timeout to cover the startup grace period", async () => {
  let calls = 0;
  let currentTime = 0;

  await waitForServiceReadyWithDependencies(
    "demo",
    "app",
    { retries: 20, intervalSeconds: 3, startPeriodSeconds: 300 },
    {
      inspectContainerByName: async () => {
        calls += 1;
        return {
          name: "demo-app",
          state: "running",
          running: true,
          health: currentTime >= 120_000 ? "healthy" : "starting",
          image: "demo"
        };
      },
      sleep: async (ms) => {
        currentTime += ms;
      },
      now: () => currentTime
    }
  );

  assert.ok(calls > 20);
  assert.equal(currentTime, 120_000);
});

test("waitForServiceReady points to logs when the container exits", async () => {
  await assert.rejects(
    () =>
      waitForServiceReadyWithDependencies(
        "demo",
        "app",
        { retries: 1, intervalSeconds: 1 },
        {
          inspectContainerByName: async () => ({
            name: "demo-app",
            state: "exited",
            running: false,
            image: "demo"
          }),
          sleep: async () => undefined,
          now: () => 0
        }
      ),
    /Container 'demo-app' exited before becoming ready\. Check 'devroost logs app --no-follow' for the startup failure\./i
  );
});