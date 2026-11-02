import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { findStackDefinition, generatorPins, runtimeImagePins, stackDefinitions } from "./index.js";
import { validateGeneratorVersion, validateRuntimeImage, validateStackDefinition, validateStackDocumentation } from "./definition.js";

function templateServiceNames(yaml: string): string[] {
  const servicesSection = yaml.match(/^services:\n([\s\S]*?)(?=^(?:routes|tasks):|$(?![\s\S]))/m)?.[1] ?? "";
  return [...servicesSection.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]!);
}

test("pin validators reject floating versions and accept exact tag families", () => {
  for (const reference of ["node", "node:latest", "node:24", "node:24.4", "postgres:16", "composer:2"]) {
    assert.throws(() => validateRuntimeImage({ env: "NODE_IMAGE", reference }), /exact version tag/i);
  }
  for (const reference of [
    "node:24.20.0-alpine", "postgres:16.15-alpine3.24", "mcr.microsoft.com/mssql/server:2022-CU26-ubuntu-22.04",
    `node:24.20.0-alpine@sha256:${"a".repeat(64)}`
  ]) assert.doesNotThrow(() => validateRuntimeImage({ env: "NODE_IMAGE", reference }));
  assert.throws(() => validateRuntimeImage({ env: "node_image", reference: "node:24.20.0-alpine" }), /uppercase/i);

  for (const version of ["", "latest", "next", "nightly", "unversioned", "^7.1.5", "7.x", "*"]) {
    assert.throws(() => validateGeneratorVersion(version), /exact generator version/i);
  }
  for (const version of ["7.1.5", "11.1", "6.8.3-beta.1"]) assert.doesNotThrow(() => validateGeneratorVersion(version));
});

test("definitions enforce version, aliases, canonical assets, and maintenance safety", () => {
  const node = findStackDefinition("node")!;
  assert.throws(() => validateStackDefinition({ ...node, definitionVersion: 0 }), /positive integer/i);
  assert.throws(() => validateStackDefinition({ ...node, assetPath: "../node" }), /unsafe asset path/i);
  assert.throws(() => validateStackDefinition({ ...node, legacyScaffoldVersions: ["1", "1"] }), /duplicate legacy/i);
  assert.throws(() => validateStackDefinition({ ...node, legacyScaffoldVersions: ["z", "a"] }), /sorted/i);
  assert.throws(
    () => validateStackDefinition({ ...node, verification: [{ command: [] }] as never }),
    /verification command/i
  );
  assert.throws(
    () => validateStackDefinition({ ...node, verification: [{ command: [""] }] as never }),
    /verification command/i
  );
  assert.throws(
    () => validateStackDefinition({ ...node, verification: [{ service: "", command: ["true"] }] as never }),
    /verification service/i
  );
  assert.doesNotThrow(() => validateStackDefinition({ ...node, verification: [{ command: ["true"] }] }));
  for (const definition of stackDefinitions) assert.doesNotThrow(() => validateStackDefinition(definition));
});

test("every canonical stack publishes complete launch documentation", async () => {
  assert.equal(stackDefinitions.length, 31);
  for (const definition of stackDefinitions) {
    assert.doesNotThrow(() => validateStackDocumentation(definition.id, definition.documentation));
    assert.equal(definition.documentation.initCommand.startsWith(`devroost init ${definition.id} `), true, definition.id);

    const yaml = await readFile(resolve(fileURLToPath(new URL(".", import.meta.url)), "..", definition.assetPath, "devroost.yaml"), "utf8");
    assert.deepEqual(
      definition.documentation.services.map(({ name }) => name).sort(),
      templateServiceNames(yaml).sort(),
      `${definition.id} documented services`
    );
  }
});

test("database stack documentation cannot advertise optional databases", () => {
  const documentation = findStackDefinition("db-postgres")!.documentation;
  assert.throws(
    () => validateStackDocumentation("db-postgres", { ...documentation, supportsOptionalDatabases: true }),
    /cannot support optional databases/i
  );
});

test("runtime defaults use immutable images published by Devroost", () => {
  for (const definition of stackDefinitions) {
    for (const image of definition.runtimeImages) {
      assert.match(
        image.reference,
        /^ghcr\.io\/loom-development\/[a-z0-9.-]+@sha256:[a-f0-9]{64}$/,
        `${definition.id} ${image.env}`
      );
    }
  }
});

test("language application stacks publish exact versioned package definitions", () => {
  const expected = {
    python: [{ env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }],
    "python-django": [{ env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }],
    "python-flask": [{ env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }],
    "python-fastapi": [{ env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }],
    php: [{ env: "PHP_IMAGE", reference: runtimeImagePins.php84Apache }],
    dotnet: [{ env: "DOTNET_IMAGE", reference: runtimeImagePins.dotnet8Sdk }],
    "spring-react": [
      { env: "JAVA_IMAGE", reference: runtimeImagePins.maven39Temurin21 },
      { env: "NODE_IMAGE", reference: runtimeImagePins.node22Alpine }
    ],
    "spring-boot": [{ env: "JAVA_IMAGE", reference: runtimeImagePins.maven39Temurin21 }],
    "django-react": [
      { env: "NODE_IMAGE", reference: runtimeImagePins.node24Alpine },
      { env: "PYTHON_IMAGE", reference: runtimeImagePins.python312Slim }
    ]
  } as const;

  for (const [id, runtimeImages] of Object.entries(expected)) {
    const definition = findStackDefinition(id)!;
    assert.equal(definition.definitionVersion, 2, id);
    assert.deepEqual(definition.legacyScaffoldVersions, ["1", "2"], id);
    assert.equal(definition.assetPath, `${id}/templates`, id);
    assert.deepEqual(definition.generator, { kind: "none" }, id);
    assert.deepEqual(definition.runtimeImages, runtimeImages, id);
  }

  assert.deepEqual(findStackDefinition("php")!.generatedPaths, [{ path: "vendor", category: "dependency" }]);
});

test("bootstrap-heavy stacks publish exact generator and runtime pins", () => {
  const expected = {
    "php-wordpress": {
      aliases: ["2", "wordpress-6-php8.3-apache"],
      generator: {
        kind: "command",
        image: runtimeImagePins.wordpress683Php84Apache,
        package: "wordpress",
        version: "6.8.3",
        command: ["sh", "-c", "cp -a /usr/src/wordpress/. /app/"],
        execution: {
          kind: "container",
          context: "WordPress project with Podman",
          mountTarget: "/app",
          environment: []
        }
      },
      runtimeImages: [
        { env: "WORDPRESS_IMAGE", reference: runtimeImagePins.wordpress683Php84Apache }
      ]
    },
    "php-drupal": {
      aliases: ["2", "unversioned"],
      generator: {
        kind: "command",
        image: "docker.io/library/composer:2.8.10",
        package: "drupal/recommended-project",
        version: "11.2.2",
        command: ["create-project", "{package}:{version}", "."],
        execution: {
          kind: "container",
          context: "Drupal project with Podman Composer",
          mountTarget: "/app",
          workdir: "/app",
          environment: [{ name: "HOME", value: "/tmp" }]
        }
      },
      runtimeImages: [
        { env: "PHP_IMAGE", reference: runtimeImagePins.php84Apache }
      ]
    },
    "php-symfony": {
      aliases: ["2", "unversioned"],
      generator: {
        kind: "command",
        image: "docker.io/library/composer:2.8.10",
        package: "symfony/skeleton",
        version: "7.3.99",
        command: [
          "sh",
          "-c",
          "composer create-project {package}:{version} . && composer require symfony/webapp-pack:1.3.0"
        ],
        execution: {
          kind: "container",
          context: "Symfony project with Podman Composer",
          mountTarget: "/app",
          workdir: "/app",
          environment: [{ name: "HOME", value: "/tmp" }]
        }
      },
      runtimeImages: [
        { env: "PHP_IMAGE", reference: runtimeImagePins.php84Apache }
      ]
    },
    rails7: {
      aliases: ["2", "rails-7.1.5"],
      generator: {
        kind: "command",
        image: runtimeImagePins.ruby3312,
        package: "rails",
        version: "7.1.5",
        command: [
          "sh",
          "-c",
          "gem install bundler -v 2.6.9 --no-document && gem install {package} -v {version} --no-document && /usr/local/bundle/bin/rails _{version}_ new . --skip-javascript --skip-test --skip-system-test"
        ],
        execution: {
          kind: "container",
          context: "Rails 7 project with Podman",
          mountTarget: "/workspace",
          workdir: "/workspace",
          environment: []
        }
      },
      runtimeImages: [{ env: "RUBY_IMAGE", reference: runtimeImagePins.ruby3312 }]
    },
    "rails7-hotwire": {
      aliases: ["2", "rails-7.1.5-hotwire"],
      generator: {
        kind: "command",
        image: runtimeImagePins.ruby3312,
        package: "rails",
        version: "7.1.5",
        command: [
          "sh",
          "-c",
          "gem install bundler -v 2.6.9 --no-document && gem install {package} -v {version} --no-document && /usr/local/bundle/bin/rails _{version}_ new . --skip-test --skip-system-test"
        ],
        execution: {
          kind: "container",
          context: "Rails 7 + Hotwire project with Podman",
          mountTarget: "/workspace",
          workdir: "/workspace",
          environment: []
        }
      },
      runtimeImages: [{ env: "RUBY_IMAGE", reference: runtimeImagePins.ruby3312 }]
    }
  } as const;

  for (const [id, metadata] of Object.entries(expected)) {
    const definition = findStackDefinition(id)!;
    assert.equal(definition.definitionVersion, 2, id);
    assert.equal(definition.scaffoldVersion, "2", id);
    assert.deepEqual(definition.legacyScaffoldVersions, metadata.aliases, `${id} aliases`);
    assert.deepEqual(definition.generator, metadata.generator, `${id} generator`);
    assert.deepEqual(definition.runtimeImages, metadata.runtimeImages, `${id} images`);
  }

  const symfony = findStackDefinition("php-symfony")!;
  assert.equal(symfony.generator.kind, "command");
  if (symfony.generator.kind === "command") {
    const secondaryVersion = /symfony\/webapp-pack:([^\s]+)/.exec(symfony.generator.command.join(" "))?.[1];
    assert.equal(secondaryVersion, generatorPins.symfonyWebappPack);
    assert.doesNotThrow(() => validateGeneratorVersion(secondaryVersion!));
  }

  const wordpress = findStackDefinition("php-wordpress")!;
  assert.deepEqual(wordpress.install, []);
  assert.deepEqual(wordpress.start, ["docker-entrypoint.sh apache2-foreground"]);
  assert.deepEqual(wordpress.readiness, { kind: "port", value: "127.0.0.1:80", timeoutSeconds: 90 });
});

test("database stacks publish exact versioned package definitions and lifecycle metadata", () => {
  const expected = {
    "db-mysql": {
      runtimeImages: [{ env: "MYSQL_IMAGE", reference: runtimeImagePins.mysql84 }],
      start: [], readiness: { kind: "command", value: "mysqladmin ping -h 127.0.0.1 -uroot -ploomroot", timeoutSeconds: 100 },
      verification: [{ service: "db", command: ["mysql", "-h", "127.0.0.1", "-uloom", "-ploom", "loom", "-e", "SELECT 1"] }],
      architectures: ["arm64", "x64"]
    },
    "db-sqlserver": {
      runtimeImages: [{ env: "MSSQL_IMAGE", reference: runtimeImagePins.mssql2022 }],
      start: [], readiness: { kind: "port", value: "127.0.0.1:1433", timeoutSeconds: 300 },
      verification: [{ service: "db", command: ["/opt/mssql-tools18/bin/sqlcmd", "-S", "127.0.0.1", "-U", "sa", "-P", "LoomDev!Passw0rd", "-C", "-Q", "SELECT 1"] }],
      architectures: ["x64"]
    },
    "db-postgres": {
      runtimeImages: [{ env: "POSTGRES_IMAGE", reference: runtimeImagePins.postgres16Alpine }],
      start: [], readiness: { kind: "command", value: "pg_isready -U loom", timeoutSeconds: 95 },
      verification: [{ service: "db", command: ["psql", "-U", "loom", "-d", "loom", "-c", "SELECT 1"] }],
      architectures: ["arm", "arm64", "x64"]
    },
    "db-mongodb": {
      runtimeImages: [{ env: "MONGO_IMAGE", reference: runtimeImagePins.mongo70 }],
      start: [], readiness: { kind: "port", value: "127.0.0.1:27017", timeoutSeconds: 120 },
      verification: [{ service: "db", command: ["mongosh", "--quiet", "--host", "127.0.0.1", "--username", "loom", "--password", "loom", "--authenticationDatabase", "admin", "--eval", "quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)"] }],
      architectures: ["arm64", "x64"]
    },
    "db-redis": {
      runtimeImages: [{ env: "REDIS_IMAGE", reference: runtimeImagePins.redis74Alpine }],
      start: ["redis-server --appendonly yes"], readiness: { kind: "command", value: "redis-cli ping | grep PONG", timeoutSeconds: 92 },
      verification: [{ service: "db", command: ["redis-cli", "ping"] }],
      architectures: ["arm", "arm64", "x64"]
    },
    "db-elasticsearch": {
      runtimeImages: [{ env: "ELASTICSEARCH_IMAGE", reference: runtimeImagePins.elasticsearch819 }],
      start: [], readiness: { kind: "http", value: "http://127.0.0.1:9200/_cluster/health", timeoutSeconds: 300 },
      verification: [{ service: "db", command: ["curl", "--fail", "http://127.0.0.1:9200/_cluster/health"] }],
      architectures: ["arm64", "x64"]
    },
    "db-sqlite": {
      runtimeImages: [{ env: "SQLITE_IMAGE", reference: runtimeImagePins.sqlite353 }],
      start: ["sh -c \"sqlite3 /data/loom.db 'select 1;' && tail -f /dev/null\""],
      readiness: { kind: "command", value: "sqlite3 /data/loom.db 'select 1;'", timeoutSeconds: 60 },
      verification: [{ service: "db", command: ["sqlite3", "/data/loom.db", "select 1;"] }],
      architectures: ["arm", "arm64", "x64"]
    },
    "db-mariadb": {
      runtimeImages: [{ env: "MARIADB_IMAGE", reference: runtimeImagePins.mariadb118 }],
      start: [], readiness: { kind: "command", value: "mariadb-admin ping -h 127.0.0.1 -uroot -ploomroot", timeoutSeconds: 100 },
      verification: [{ service: "db", command: ["mariadb", "-h", "127.0.0.1", "-uloom", "-ploom", "loom", "-e", "SELECT 1"] }],
      architectures: ["arm64", "x64"]
    },
    "db-all": {
      runtimeImages: [
        { env: "ELASTICSEARCH_IMAGE", reference: runtimeImagePins.elasticsearch819 },
        { env: "MARIADB_IMAGE", reference: runtimeImagePins.mariadb118 },
        { env: "MONGO_IMAGE", reference: runtimeImagePins.mongo70 },
        { env: "MSSQL_IMAGE", reference: runtimeImagePins.mssql2022 },
        { env: "MYSQL_IMAGE", reference: runtimeImagePins.mysql84 },
        { env: "POSTGRES_IMAGE", reference: runtimeImagePins.postgres16Alpine },
        { env: "REDIS_IMAGE", reference: runtimeImagePins.redis74Alpine },
        { env: "SQLITE_IMAGE", reference: runtimeImagePins.sqlite353 }
      ],
      start: ["redis-server --appendonly yes", "sh -c \"sqlite3 /data/loom.db 'select 1;' && tail -f /dev/null\""],
      readiness: { kind: "http", value: "http://127.0.0.1:9200/_cluster/health", timeoutSeconds: 300 },
      verification: [
        { service: "mysql", command: ["mysql", "-h", "127.0.0.1", "-uloom", "-ploom", "loom", "-e", "SELECT 1"] },
        { service: "sqlserver", command: ["/opt/mssql-tools18/bin/sqlcmd", "-S", "127.0.0.1", "-U", "sa", "-P", "LoomDev!Passw0rd", "-C", "-Q", "SELECT 1"] },
        { service: "postgres", command: ["psql", "-U", "loom", "-d", "loom", "-c", "SELECT 1"] },
        { service: "mongodb", command: ["mongosh", "--quiet", "--host", "127.0.0.1", "--username", "loom", "--password", "loom", "--authenticationDatabase", "admin", "--eval", "quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)"] },
        { service: "redis", command: ["redis-cli", "ping"] },
        { service: "elasticsearch", command: ["curl", "--fail", "http://127.0.0.1:9200/_cluster/health"] },
        { service: "sqlite", command: ["sqlite3", "/data/loom.db", "select 1;"] },
        { service: "mariadb", command: ["mariadb", "-h", "127.0.0.1", "-uloom", "-ploom", "loom", "-e", "SELECT 1"] }
      ],
      architectures: ["x64"]
    }
  } as const;

  for (const [id, metadata] of Object.entries(expected)) {
    const definition = findStackDefinition(id)!;
    assert.equal(definition.definitionVersion, 2, id);
    assert.deepEqual(definition.legacyScaffoldVersions, ["1", "2"], id);
    assert.equal(definition.assetPath, `${id}/templates`, id);
    assert.deepEqual(definition.generator, { kind: "none" }, id);
    assert.deepEqual(definition.runtimeImages, metadata.runtimeImages, `${id} images`);
    assert.deepEqual(definition.install, [], `${id} install`);
    assert.deepEqual(definition.start, metadata.start, `${id} start`);
    assert.deepEqual(definition.readiness, metadata.readiness, `${id} readiness`);
    assert.deepEqual(definition.verification, metadata.verification, `${id} verification`);
    assert.deepEqual(definition.compatibility.architectures, metadata.architectures, `${id} architectures`);
    assert.deepEqual(definition.hostWrites, [], `${id} host writes`);
    assert.deepEqual(definition.generatedPaths, [], `${id} generated paths`);
    assert.deepEqual(definition.protectedPaths, [], `${id} protected paths`);
  }

  assert.deepEqual(
    stackDefinitions.filter(({ definitionVersion }) => definitionVersion === 1).map(({ id }) => id),
    []
  );
});

test("database verification checks target existing services and cover every db-all service", async () => {
  const databaseIds = [
    "db-mysql", "db-sqlserver", "db-postgres", "db-mongodb", "db-redis", "db-elasticsearch", "db-sqlite",
    "db-mariadb", "db-all"
  ] as const;
  for (const id of databaseIds) {
    const definition = findStackDefinition(id)!;
    const yaml = await readFile(resolve(fileURLToPath(new URL(".", import.meta.url)), "..", definition.assetPath, "devroost.yaml"), "utf8");
    const serviceNames = templateServiceNames(yaml);
    const checks = definition.verification;
    assert.ok(checks.length > 0, `${id} verification checks`);
    assert.ok(checks.every(({ service }) => service !== undefined), `${id} has no host-only image client`);
    for (const check of checks) assert.ok(serviceNames.includes(check.service!), `${id} service ${check.service}`);
    if (id === "db-all") assert.deepEqual(checks.map(({ service }) => service), serviceNames, "db-all service coverage and order");
  }
});

test("verification checks only target services declared by their templates", async () => {
  for (const definition of stackDefinitions.filter(({ definitionVersion }) => definitionVersion === 2)) {
    const yaml = await readFile(resolve(fileURLToPath(new URL(".", import.meta.url)), "..", definition.assetPath, "devroost.yaml"), "utf8");
    const serviceNames = templateServiceNames(yaml);
    for (const check of definition.verification) {
      if (check.service !== undefined) assert.ok(serviceNames.includes(check.service), `${definition.id} service ${check.service}`);
    }
  }
});

test("Node template inventory and bytes match the approved migration fixture", async () => {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "node");
  const expected = JSON.parse(await readFile(resolve(root, "fixtures/expected.json"), "utf8")) as Record<string, string>;
  const entries = (await readdir(resolve(root, "templates"))).sort();
  assert.deepEqual(entries, Object.keys(expected).sort());
  for (const entry of entries) {
    let bytes = await readFile(resolve(root, "templates", entry));
    if (entry === ".env.example") bytes = Buffer.from(bytes.toString("utf8").replace(/^NODE_IMAGE=.*$/m, "NODE_IMAGE=<IMAGE>"));
    if (entry === "README.md") bytes = Buffer.from(bytes.toString("utf8").replace(/\$\{NODE_IMAGE:-[^}\s]+\}/g, "${NODE_IMAGE:-<IMAGE>}"));
    if (entry === "devroost.yaml") bytes = Buffer.from(bytes.toString("utf8").replace(/\$\{NODE_IMAGE:-[^}\s]+\}/g, "${NODE_IMAGE:-<IMAGE>}"));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected[entry], entry);
  }
  assert.match(await readFile(resolve(root, "templates/devroost.yaml"), "utf8"), /ghcr\.io\/loom-development\/loom-node-24@sha256:[a-f0-9]{64}/);
});
