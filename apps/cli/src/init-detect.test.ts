import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectInitTemplateSuggestion } from "./init-detect.js";

test("detectInitTemplateSuggestion detects Drupal composer projects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devroost-cli-detect-"));
  await writeFile(
    join(dir, "composer.json"),
    JSON.stringify({ require: { "drupal/core-recommended": "^11" } }),
    "utf8"
  );

  assert.equal(await detectInitTemplateSuggestion(dir), "php-drupal");
});

test("detectInitTemplateSuggestion detects Flask requirements", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devroost-cli-detect-"));
  await writeFile(join(dir, "requirements.txt"), "Flask==3.1.0\n", "utf8");

  assert.equal(await detectInitTemplateSuggestion(dir), "python-flask");
});

test("detectInitTemplateSuggestion detects Rails Gemfile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devroost-cli-detect-"));
  await writeFile(join(dir, "Gemfile"), "gem 'rails', '~> 7.1'\n", "utf8");

  assert.equal(await detectInitTemplateSuggestion(dir), "rails7");
});

test("detectInitTemplateSuggestion detects generic package.json projects as node", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devroost-cli-detect-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }), "utf8");

  assert.equal(await detectInitTemplateSuggestion(dir), "node");
});