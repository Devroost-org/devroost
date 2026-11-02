import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { testImage } from "./test-image.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

test("runs a custom image contract through its public shell boundary", async () => {
  const calls = [];
  await testImage("devroost-php", "localhost/devroost-php:dev", {
    catalogPath: path.join(repositoryRoot, "images/catalog.json"),
    checkFile: async () => {},
    execute: async (command, args, options) => {
      calls.push({ command, args, options });
    }
  });

  assert.deepEqual(calls, [
    {
      command: "bash",
      args: [
        path.join(repositoryRoot, "images/php/contract.sh"),
        "localhost/devroost-php:dev"
      ],
      options: { cwd: repositoryRoot }
    }
  ]);
});

test("rejects mirrors and missing custom contracts", async () => {
  const catalogPath = path.join(repositoryRoot, "images/catalog.json");
  await assert.rejects(
    testImage("postgres-16", "localhost/postgres:dev", {
      catalogPath,
      execute: async () => {}
    }),
    /is a mirror and has no custom contract/
  );
  await assert.rejects(
    testImage("devroost-php", "localhost/devroost-php:dev", {
      catalogPath,
      checkFile: async () => {
        throw new Error("missing");
      },
      execute: async () => {}
    }),
    /is missing contract/
  );
});
