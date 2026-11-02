import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findStackDefinition, stackDefinitions } from "./index.js";

const root = dirname(fileURLToPath(import.meta.url));
const bootstrapIds = ["php-wordpress", "php-drupal", "php-symfony", "rails7", "rails7-hotwire"] as const;
const ids = [
  "node-mean", "node-mern", "node-t3", "bun", "jamstack", "serverless", "astro",
  "python", "python-django", "python-flask", "python-fastapi", "php", "dotnet", "spring-react", "spring-boot",
  "django-react", "db-mysql", "db-sqlserver", "db-postgres", "db-mongodb", "db-redis", "db-elasticsearch",
  "db-sqlite", "db-mariadb", "db-all", ...bootstrapIds
] as const;
const databaseIds = [
  "db-mysql", "db-sqlserver", "db-postgres", "db-mongodb", "db-redis", "db-elasticsearch", "db-sqlite",
  "db-mariadb", "db-all"
] as const;

function normalizeImageDefaults(yaml: string, imageEnvs: readonly string[]): string {
  const declared = new Set(imageEnvs);
  return yaml.replace(
    /(^\s*image:\s*)\$\{([A-Z][A-Z0-9_]*):-.*?\}/gm,
    (match, prefix: string, env: string) => declared.has(env) ? `${prefix}\${${env}:-<IMAGE>}` : match
  );
}

function normalizeEnvironmentImageDefaults(envFile: string, imageEnvs: readonly string[]): string {
  const declared = new Set(imageEnvs);
  return envFile.replace(/^([A-Z][A-Z0-9_]*_IMAGE)=.*$/gm, (line, env: string) => declared.has(env) ? `${env}=<IMAGE>` : line);
}

function normalizeReadmeImageDefaults(readme: string, imageEnvs: readonly string[]): string {
  const declared = new Set(imageEnvs);
  return readme
    .replace(/\$\{([A-Z][A-Z0-9_]*_IMAGE):-([^}\s]+)\}/g, (line, env: string) => declared.has(env) ? `\${${env}:-<IMAGE>}` : line)
    .replace(/\b([A-Z][A-Z0-9_]*_IMAGE)=([^\s`]+)/g, (line, env: string) => declared.has(env) ? `${env}=<IMAGE>` : line);
}

async function filesBelow(directory: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else result.push(relative(directory, path).split(sep).join("/"));
    }
  }
  await visit(directory);
  return result.sort();
}

test("copy stack migration preserves every non-image template byte", async () => {
  for (const id of ids) {
    const stackRoot = resolve(root, "..", id);
    const templateRoot = resolve(stackRoot, "templates");
    const definition = findStackDefinition(id)!;
    const fixture = JSON.parse(await readFile(resolve(stackRoot, "fixtures/migration.json"), "utf8")) as { fileCount: number; sourceDigest: string; devroostDigest: string };
    const files = (await filesBelow(templateRoot)).filter((path) => path !== "devroost.yaml");
    const digest = createHash("sha256");
    for (const path of files) {
      let bytes = await readFile(resolve(templateRoot, path));
      if (path === ".env.example") {
        bytes = Buffer.from(normalizeEnvironmentImageDefaults(bytes.toString("utf8"), definition.runtimeImages.map(({ env }) => env)));
      } else if (path === "README.md") {
        bytes = Buffer.from(normalizeReadmeImageDefaults(bytes.toString("utf8"), definition.runtimeImages.map(({ env }) => env)));
      }
      digest.update(path).update("\0").update(bytes);
    }
    assert.equal(files.length, fixture.fileCount, `${id} inventory`);
    assert.equal(digest.digest("hex"), fixture.sourceDigest, `${id} source bytes`);
    const yaml = await readFile(resolve(templateRoot, "devroost.yaml"), "utf8");
    const normalizedYaml = normalizeImageDefaults(yaml, definition.runtimeImages.map(({ env }) => env));
    assert.equal(createHash("sha256").update(normalizedYaml).digest("hex"), fixture.devroostDigest, `${id} Devroost configuration`);
  }
});

test("application templates never install operating-system packages during startup", async () => {
  const forbidden = /\b(?:apt-get|apk\s+add|pecl\s+install|docker-php-ext-(?:install|enable))\b/;
  for (const definition of stackDefinitions) {
    if (definition.id.startsWith("db-")) continue;
    const yaml = await readFile(resolve(root, "..", definition.assetPath, "devroost.yaml"), "utf8");
    assert.doesNotMatch(yaml, forbidden, definition.id);
  }
});

test("Node-family templates run directly as the host user", async () => {
  for (const id of ["node", "astro", "node-mean", "node-mern", "node-t3"] as const) {
    const definition = findStackDefinition(id)!;
    const yaml = await readFile(resolve(root, "..", definition.assetPath, "devroost.yaml"), "utf8");
    assert.match(yaml, /user:\s*\$\{HOST_UID:-1000\}:\$\{HOST_GID:-1000\}/, id);
    assert.doesNotMatch(yaml, /user:\s*root|execUser:|setpriv|apt-get|apk\s+add/, id);
  }
});

test("Python-family templates run directly as the host user", async () => {
  for (const id of ["python", "python-django", "python-flask", "python-fastapi"] as const) {
    const definition = findStackDefinition(id)!;
    const yaml = await readFile(resolve(root, "..", definition.assetPath, "devroost.yaml"), "utf8");
    assert.match(yaml, /user:\s*\$\{HOST_UID:-1000\}:\$\{HOST_GID:-1000\}/, id);
    assert.doesNotMatch(yaml, /user:\s*root|execUser:|setpriv|apt-get|apk\s+add/, id);
  }
});

test("Rails templates run directly as the host user", async () => {
  for (const id of ["rails7", "rails7-hotwire"] as const) {
    const definition = findStackDefinition(id)!;
    const yaml = await readFile(resolve(root, "..", definition.assetPath, "devroost.yaml"), "utf8");
    assert.match(yaml, /user:\s*\$\{HOST_UID:-1000\}:\$\{HOST_GID:-1000\}/, id);
    assert.doesNotMatch(yaml, /user:\s*root|execUser:|setpriv|apt-get|apk\s+add/, id);
  }
});

test("migration normalization preserves non-image environment defaults", async () => {
  const yaml = await readFile(resolve(root, "..", "node-mean/templates/devroost.yaml"), "utf8");
  const imageEnvs = findStackDefinition("node-mean")!.runtimeImages.map(({ env }) => env);
  const changed = yaml.replace("${HOST_UID:-1000}", "${HOST_UID:-1001}");
  assert.notEqual(changed, yaml, "fixture must contain a non-image default");
  assert.notEqual(
    createHash("sha256").update(normalizeImageDefaults(changed, imageEnvs)).digest("hex"),
    createHash("sha256").update(normalizeImageDefaults(yaml, imageEnvs)).digest("hex")
  );
});

test("YAML migration normalization permits declared image pins only", async () => {
  const definition = findStackDefinition("db-mysql")!;
  const yaml = await readFile(resolve(root, "..", definition.assetPath, "devroost.yaml"), "utf8");
  const imageEnvs = definition.runtimeImages.map(({ env }) => env);
  const normalized = normalizeImageDefaults(yaml, imageEnvs);
  assert.equal(normalizeImageDefaults(yaml.replace("mysql:8.4.11", "mysql:8.4.99"), imageEnvs), normalized);
  assert.notEqual(normalizeImageDefaults(yaml.replace("MYSQL_IMAGE", "UNDECLARED_IMAGE"), imageEnvs), normalized);
});

test("environment migration normalization permits declared image pins only", async () => {
  const definition = findStackDefinition("php")!;
  const env = await readFile(resolve(root, "..", "php/templates/.env.example"), "utf8");
  const imageEnvs = definition.runtimeImages.map(({ env: name }) => name);
  const normalized = normalizeEnvironmentImageDefaults(env, imageEnvs);
  const phpImage = definition.runtimeImages.find(({ env: name }) => name === "PHP_IMAGE")!.reference;
  assert.equal(
    normalizeEnvironmentImageDefaults(env.replace(phpImage, "docker.io/library/php:8.4.99-apache"), imageEnvs),
    normalized
  );
  assert.notEqual(normalizeEnvironmentImageDefaults(env.replace("HOST_UID=1000", "HOST_UID=1001"), imageEnvs), normalized);
});

test("runtime write metadata matches dependency-free Bun and Serverless templates", () => {
  for (const id of ["bun", "serverless"] as const) {
    const definition = findStackDefinition(id)!;
    assert.deepEqual(definition.hostWrites, [], `${id} host writes`);
    assert.deepEqual(definition.generatedPaths, [], `${id} generated paths`);
  }
});

test("copy stack template image defaults exactly match their definitions", async () => {
  for (const id of ids) {
    const definition = findStackDefinition(id)!;
    const yaml = await readFile(resolve(root, "..", definition.assetPath, "devroost.yaml"), "utf8");
    const defaults = [...yaml.matchAll(/image:\s*\$\{([A-Z][A-Z0-9_]*)[:-]-(.+?)\}/g)].map((match) => ({ env: match[1]!, reference: match[2]! }));
    const imagesByEnv = new Map(definition.runtimeImages.map((image) => [image.env, image.reference]));
    assert.deepEqual([...new Set(defaults.map(({ env }) => env))].sort(), [...imagesByEnv.keys()].sort(), `${id} image environments`);
    for (const image of defaults) assert.equal(image.reference, imagesByEnv.get(image.env), `${id} ${image.env}`);
  }
});

test("packaged stack READMEs document only their exact definition runtime pins", async () => {
  for (const definition of stackDefinitions) {
    const readme = await readFile(resolve(root, "..", definition.assetPath, "README.md"), "utf8");
    const documented = [
      ...[...readme.matchAll(/\$\{([A-Z][A-Z0-9_]*_IMAGE):-([^}\s`]+)\}/g)].map((match) => ({
        env: match[1]!, reference: match[2]!
      })),
      ...[...readme.matchAll(/\b([A-Z][A-Z0-9_]*_IMAGE)=([^\s`]+)/g)].map((match) => ({
        env: match[1]!, reference: match[2]!
      }))
    ];
    const uniqueDocumented = [...new Map(documented.map((image) => [`${image.env}\0${image.reference}`, image])).values()]
      .sort((a, b) => a.env.localeCompare(b.env) || a.reference.localeCompare(b.reference));
    assert.deepEqual(uniqueDocumented, definition.runtimeImages, definition.id);

    const expectedReferences = new Set(definition.runtimeImages.map(({ reference }) => reference));
    const imageReferences = [...readme.matchAll(/\b(?:docker\.io|docker\.elastic\.co|mcr\.microsoft\.com)\/[^\s`}),;]+/g)]
      .map((match) => match[0]!);
    for (const reference of imageReferences) {
      assert.ok(expectedReferences.has(reference), `${definition.id} undocumented runtime reference ${reference}`);
    }
  }
});

test("every stack environment image default exactly matches its definition", async () => {
  for (const definition of stackDefinitions) {
    const env = await readFile(resolve(root, "..", definition.assetPath, ".env.example"), "utf8");
    const defaults = [...env.matchAll(/^([A-Z][A-Z0-9_]*_IMAGE)=(.+)$/gm)].map((match) => ({ env: match[1]!, reference: match[2]! }));
    assert.deepEqual(defaults.sort((a, b) => a.env.localeCompare(b.env)), definition.runtimeImages, definition.id);
  }
});

test("Python stack lifecycle and maintenance metadata stays exact", () => {
  const expected = {
    python: {
      hostWrites: [],
      generatedPaths: [
        { path: ".pytest_cache", category: "cache" },
        { path: ".venv", category: "dependency" },
        { path: "__pycache__", category: "cache" }
      ]
    },
    "python-django": {
      hostWrites: ["db.sqlite3", "project/__pycache__"],
      generatedPaths: [
        { path: ".pytest_cache", category: "cache" },
        { path: ".venv", category: "dependency" },
        { path: "__pycache__", category: "cache" }
      ]
    },
    "python-flask": {
      hostWrites: ["__pycache__"],
      generatedPaths: [
        { path: ".pytest_cache", category: "cache" },
        { path: ".venv", category: "dependency" },
        { path: "__pycache__", category: "cache" }
      ]
    },
    "python-fastapi": {
      hostWrites: ["app/__pycache__"],
      generatedPaths: [
        { path: ".pytest_cache", category: "cache" },
        { path: ".venv", category: "dependency" },
        { path: "__pycache__", category: "cache" }
      ]
    },
    "django-react": {
      hostWrites: ["backend/db.sqlite3", "backend/project/__pycache__", "frontend/node_modules", "frontend/package-lock.json"],
      generatedPaths: [
        { path: "backend/.pytest_cache", category: "cache" },
        { path: "backend/.venv", category: "dependency" },
        { path: "frontend/dist", category: "build" },
        { path: "frontend/node_modules", category: "dependency" }
      ]
    }
  } as const;

  for (const [id, metadata] of Object.entries(expected)) {
    const definition = findStackDefinition(id)!;
    assert.deepEqual(definition.hostWrites, metadata.hostWrites, `${id} host writes`);
    assert.deepEqual(definition.generatedPaths, metadata.generatedPaths, `${id} generated paths`);
  }
});

test("database data and runtime state are never maintenance targets", () => {
  for (const id of databaseIds) {
    const definition = findStackDefinition(id)!;
    assert.deepEqual(definition.hostWrites, [], `${id} host writes`);
    assert.deepEqual(definition.generatedPaths, [], `${id} generated paths`);
    assert.deepEqual(definition.protectedPaths, [], `${id} protected paths`);
  }
});

test("copy stack template packages exclude generated state", async () => {
  const forbidden = /(?:^|\/)(?:\.devroost|node_modules|vendor|\.venv|dist|build|target|bin|obj|data|\.next|\.angular|__pycache__)(?:\/|$)|\.pyc$|\.tsbuildinfo$/;
  for (const id of ids) {
    const files = await filesBelow(resolve(root, "..", id, "templates"));
    assert.deepEqual(files.filter((path) => forbidden.test(path)), [], id);
  }
});
