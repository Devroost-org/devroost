import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareInitTarget as prepareInitTargetFromDefinition,
  runDrupalCreateProjectWithDependencies,
  runRailsCreateProjectWithDependencies,
  runRailsHotwireCreateProjectWithDependencies,
  runStackGeneratorWithDependencies,
  runSymfonyCreateProjectWithDependencies,
  runWordPressCreateProjectWithDependencies
} from "./init-template.js";
import { findStackDefinition, type StackDefinition } from "./stacks.js";

function generatorImage(stackId: "php-wordpress" | "rails7" | "rails7-hotwire"): string {
  const generator = findStackDefinition(stackId)!.generator;
  assert.equal(generator.kind, "command");
  return generator.kind === "command" ? generator.image : "";
}

const wordpressImage = generatorImage("php-wordpress");
const rubyImage = generatorImage("rails7");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function prepareInitTarget(
  template: string,
  targetDir: string,
  blankTemplate: boolean,
  dependencies: Parameters<typeof prepareInitTargetFromDefinition>[3] = {}
) {
  return prepareInitTargetFromDefinition(findStackDefinition(template)!, targetDir, blankTemplate, dependencies);
}

test("prepareInitTarget returns config-only result for non-empty generic targets without --blank-template", async () => {
  assert.deepEqual(
    await prepareInitTarget("php", "/workspace/app", false, {
      directoryHasFiles: async () => true
    }),
    {
      overwriteTemplateFiles: false,
      templateEntriesToUpdate: ["devroost.yaml"],
      templateEntriesToCreateIfMissing: [".env.example"]
    }
  );
});

test("prepareInitTarget clears directory and returns full template result with --blank-template", async () => {
  const cleared: string[] = [];
  const result = await prepareInitTarget("php", "/workspace/app", true, {
    directoryHasFiles: async () => true,
    clearDirectory: async (path) => { cleared.push(path); }
  });
  assert.deepEqual(cleared, ["/workspace/app"]);
  assert.deepEqual(result, { overwriteTemplateFiles: false });
});

test("prepareInitTarget bootstraps Drupal projects in empty targets", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("php-drupal", "/workspace/drupal", false, {
    directoryHasFiles: async () => false,
    runDrupalCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), { overwriteTemplateFiles: false });

  assert.deepEqual(events, ["/workspace/drupal"]);
});

test("prepareInitTarget adopts existing Drupal projects and skips bootstrap", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("php-drupal", "/workspace/drupal", false, {
    directoryHasFiles: async () => true,
    fileExists: async (path) => path.endsWith("/web/index.php"),
    runDrupalCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), {
    overwriteTemplateFiles: true,
    templateEntriesToUpdate: ["devroost.yaml"],
    templateEntriesToCreateIfMissing: [".env.example"]
  });

  assert.deepEqual(events, []);
});

test("prepareInitTarget rejects non-empty Drupal targets even when forced", async () => {
  await assert.rejects(
    () =>
      prepareInitTarget("php-drupal", "/workspace/drupal", true, {
        directoryHasFiles: async () => true
      }),
    /must be empty to initialize 'php-drupal'/i
  );
});

test("prepareInitTarget bootstraps WordPress projects in empty targets", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("php-wordpress", "/workspace/wordpress", false, {
    directoryHasFiles: async () => false,
    runWordPressCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), { overwriteTemplateFiles: false });

  assert.deepEqual(events, ["/workspace/wordpress"]);
});

test("prepareInitTarget rejects non-empty WordPress targets even when forced", async () => {
  await assert.rejects(
    () =>
      prepareInitTarget("php-wordpress", "/workspace/wordpress", true, {
        directoryHasFiles: async () => true
      }),
    /must be empty to initialize 'php-wordpress'/i
  );
});

test("prepareInitTarget adopts existing WordPress projects and skips bootstrap", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("php-wordpress", "/workspace/wordpress", false, {
    directoryHasFiles: async () => true,
    fileExists: async (path) => path.endsWith("/index.php") || path.endsWith("/wp-config.php"),
    runWordPressCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), {
    overwriteTemplateFiles: true,
    templateEntriesToUpdate: ["devroost.yaml"],
    templateEntriesToCreateIfMissing: [".env.example", "wp-config.php"]
  });

  assert.deepEqual(events, []);
});

test("prepareInitTarget bootstraps Rails 7 projects in empty targets", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("rails7", "/workspace/rails7", false, {
    directoryHasFiles: async () => false,
    runRailsCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), { overwriteTemplateFiles: false });

  assert.deepEqual(events, ["/workspace/rails7"]);
});

test("prepareInitTarget adopts existing Rails 7 projects and skips bootstrap", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("rails7", "/workspace/rails7", false, {
    directoryHasFiles: async () => true,
    fileExists: async (path) => path.endsWith("/Gemfile") || path.endsWith("/bin/rails"),
    runRailsCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), {
    overwriteTemplateFiles: true,
    templateEntriesToUpdate: ["devroost.yaml"],
    templateEntriesToCreateIfMissing: [".env.example"]
  });

  assert.deepEqual(events, []);
});

test("prepareInitTarget rejects non-empty Rails 7 targets even when forced", async () => {
  await assert.rejects(
    () =>
      prepareInitTarget("rails7", "/workspace/rails7", true, {
        directoryHasFiles: async () => true
      }),
    /must be empty to initialize 'rails7'/i
  );
});

test("prepareInitTarget bootstraps Rails 7 + Hotwire projects in empty targets", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("rails7-hotwire", "/workspace/rails-hotwire", false, {
    directoryHasFiles: async () => false,
    runRailsHotwireCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), { overwriteTemplateFiles: false });

  assert.deepEqual(events, ["/workspace/rails-hotwire"]);
});

test("prepareInitTarget adopts existing Rails 7 + Hotwire projects and skips bootstrap", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("rails7-hotwire", "/workspace/rails-hotwire", false, {
    directoryHasFiles: async () => true,
    fileExists: async (path) => path.endsWith("/Gemfile") || path.endsWith("/bin/rails"),
    runRailsHotwireCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), {
    overwriteTemplateFiles: true,
    templateEntriesToUpdate: ["devroost.yaml"],
    templateEntriesToCreateIfMissing: [".env.example"]
  });

  assert.deepEqual(events, []);
});

test("prepareInitTarget rejects non-empty Rails 7 + Hotwire targets even when forced", async () => {
  await assert.rejects(
    () =>
      prepareInitTarget("rails7-hotwire", "/workspace/rails-hotwire", true, {
        directoryHasFiles: async () => true
      }),
    /must be empty to initialize 'rails7-hotwire'/i
  );
});

test("prepareInitTarget bootstraps Symfony projects in empty targets", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("php-symfony", "/workspace/symfony", false, {
    directoryHasFiles: async () => false,
    runSymfonyCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), {
    overwriteTemplateFiles: false,
    templateEntriesToUpdate: ["devroost.yaml"],
    templateEntriesToCreateIfMissing: [".env.example"]
  });

  assert.deepEqual(events, ["/workspace/symfony"]);
});

test("prepareInitTarget adopts existing Symfony projects and skips bootstrap", async () => {
  const events: string[] = [];

  assert.deepEqual(await prepareInitTarget("php-symfony", "/workspace/symfony", false, {
    directoryHasFiles: async () => true,
    fileExists: async (path) => path.endsWith("/bin/console"),
    runSymfonyCreateProject: async (targetDir) => {
      events.push(targetDir);
    }
  }), {
    overwriteTemplateFiles: true,
    templateEntriesToUpdate: ["devroost.yaml"],
    templateEntriesToCreateIfMissing: [".env.example"]
  });

  assert.deepEqual(events, []);
});

test("prepareInitTarget rejects non-empty Symfony targets even when forced", async () => {
  await assert.rejects(
    () =>
      prepareInitTarget("php-symfony", "/workspace/symfony", true, {
        directoryHasFiles: async () => true
      }),
    /must be empty to initialize 'php-symfony'/i
  );
});

test("runDrupalCreateProjectWithDependencies uses Podman Composer", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await runDrupalCreateProjectWithDependencies("/workspace/drupal", {
    runCommand: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    }
  });

  assert.deepEqual(calls, [
    {
      command: "podman",
      args: [
    "run",
    "--rm",
    ...(process.platform === "linux" ? ["--userns=keep-id"] : []),
    "-e",
    "HOME=/tmp",
    "-v",
    "/workspace/drupal:/app",
    "-w",
    "/app",
    "docker.io/library/composer:2.8.10",
    "create-project",
    "drupal/recommended-project:11.2.2",
    "."
      ],
      cwd: "/workspace/drupal"
    }
  ]);
});

test("runDrupalCreateProjectWithDependencies reports when Podman is unavailable", async () => {
  await assert.rejects(
    () =>
      runDrupalCreateProjectWithDependencies("/workspace/drupal", {
        runCommand: async () => {
          const error = new Error("podman missing") as Error & { code?: string };
          error.code = "ENOENT";
          throw error;
        }
      }),
    /Install Podman/i
  );
});

test("runDrupalCreateProjectWithDependencies reports unavailable images clearly", async () => {
  await assert.rejects(
    () =>
      runDrupalCreateProjectWithDependencies("/workspace/drupal", {
        runCommand: async () => {
          throw new Error("manifest unknown: manifest unknown");
        }
      }),
    /image 'docker\.io\/library\/composer:2\.8\.10' is not available or could not be pulled/i
  );
});

test("runWordPressCreateProjectWithDependencies uses Podman to copy WordPress into the target", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await runWordPressCreateProjectWithDependencies("/workspace/wordpress", {
    runCommand: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    }
  });

  assert.deepEqual(calls, [
    {
      command: "podman",
      args: [
        "run",
        "--rm",
        ...(process.platform === "linux" ? ["--userns=keep-id"] : []),
        "-v",
        "/workspace/wordpress:/app",
        wordpressImage,
        "sh",
        "-c",
        "cp -a /usr/src/wordpress/. /app/"
      ],
      cwd: "/workspace/wordpress"
    }
  ]);
});

test("runWordPressCreateProjectWithDependencies reports when Podman is unavailable", async () => {
  await assert.rejects(
    () =>
      runWordPressCreateProjectWithDependencies("/workspace/wordpress", {
        runCommand: async () => {
          const error = new Error("podman missing") as Error & { code?: string };
          error.code = "ENOENT";
          throw error;
        }
      }),
    /Install Podman/i
  );
});

test("runWordPressCreateProjectWithDependencies reports unavailable images clearly", async () => {
  await assert.rejects(
    () =>
      runWordPressCreateProjectWithDependencies("/workspace/wordpress", {
        runCommand: async () => {
          throw new Error("pull access denied");
        }
      }),
    new RegExp(`image '${escapeRegExp(wordpressImage)}' requires registry access or authentication:[\\s\\S]*podman login ghcr\\.io`, "i")
  );
});

test("runRailsCreateProjectWithDependencies uses Podman to generate Rails in the target", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await runRailsCreateProjectWithDependencies("/workspace/rails7", {
    runCommand: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    }
  });

  assert.deepEqual(calls, [
    {
      command: "podman",
      args: [
        "run",
        "--rm",
        ...(process.platform === "linux" ? ["--userns=keep-id"] : []),
        "-v",
        "/workspace/rails7:/workspace",
        "-w",
        "/workspace",
        rubyImage,
        "sh",
        "-c",
        "gem install bundler -v 2.6.9 --no-document && gem install rails -v 7.1.5 --no-document && /usr/local/bundle/bin/rails _7.1.5_ new . --skip-javascript --skip-test --skip-system-test"
      ],
      cwd: "/workspace/rails7"
    }
  ]);
});

test("runRailsCreateProjectWithDependencies reports when Podman is unavailable", async () => {
  await assert.rejects(
    () =>
      runRailsCreateProjectWithDependencies("/workspace/rails7", {
        runCommand: async () => {
          const error = new Error("podman missing") as Error & { code?: string };
          error.code = "ENOENT";
          throw error;
        }
      }),
    /Install Podman/i
  );
});

test("runRailsCreateProjectWithDependencies reports unavailable images clearly", async () => {
  await assert.rejects(
    () =>
      runRailsCreateProjectWithDependencies("/workspace/rails7", {
        runCommand: async () => {
          throw new Error("image not known");
        }
      }),
    new RegExp(`image '${escapeRegExp(rubyImage)}' is not available or could not be pulled`, "i")
  );
});

test("runRailsHotwireCreateProjectWithDependencies uses Podman to generate Rails with Hotwire in the target", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await runRailsHotwireCreateProjectWithDependencies("/workspace/rails-hotwire", {
    runCommand: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    }
  });

  assert.deepEqual(calls, [
    {
      command: "podman",
      args: [
        "run",
        "--rm",
        ...(process.platform === "linux" ? ["--userns=keep-id"] : []),
        "-v",
        "/workspace/rails-hotwire:/workspace",
        "-w",
        "/workspace",
        rubyImage,
        "sh",
        "-c",
        "gem install bundler -v 2.6.9 --no-document && gem install rails -v 7.1.5 --no-document && /usr/local/bundle/bin/rails _7.1.5_ new . --skip-test --skip-system-test"
      ],
      cwd: "/workspace/rails-hotwire"
    }
  ]);
});

test("runRailsHotwireCreateProjectWithDependencies reports when Podman is unavailable", async () => {
  await assert.rejects(
    () =>
      runRailsHotwireCreateProjectWithDependencies("/workspace/rails-hotwire", {
        runCommand: async () => {
          const error = new Error("podman missing") as Error & { code?: string };
          error.code = "ENOENT";
          throw error;
        }
      }),
    /Install Podman/i
  );
});

test("runRailsCreateProjectWithDependencies reports registry auth failures clearly", async () => {
  await assert.rejects(
    () =>
      runRailsCreateProjectWithDependencies("/workspace/rails7", {
        runCommand: async () => {
          throw new Error("authentication required");
        }
      }),
    new RegExp(`image '${escapeRegExp(rubyImage)}' requires registry access or authentication:[\\s\\S]*podman login ghcr\\.io`, "i")
  );
});

test("runSymfonyCreateProjectWithDependencies uses Podman Composer", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await runSymfonyCreateProjectWithDependencies("/workspace/symfony", {
    runCommand: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    }
  });

  assert.deepEqual(calls, [
    {
      command: "podman",
      args: [
        "run",
        "--rm",
        ...(process.platform === "linux" ? ["--userns=keep-id"] : []),
        "-e",
        "HOME=/tmp",
        "-v",
        "/workspace/symfony:/app",
        "-w",
        "/app",
        "docker.io/library/composer:2.8.10",
        "sh",
        "-c",
        "composer create-project symfony/skeleton:7.3.99 . && composer require symfony/webapp-pack:1.3.0"
      ],
      cwd: "/workspace/symfony"
    }
  ]);
});

test("runSymfonyCreateProjectWithDependencies reports when Podman is unavailable", async () => {
  await assert.rejects(
    () =>
      runSymfonyCreateProjectWithDependencies("/workspace/symfony", {
        runCommand: async () => {
          const error = new Error("podman missing") as Error & { code?: string };
          error.code = "ENOENT";
          throw error;
        }
      }),
    /Install Podman/i
  );
});

test("runSymfonyCreateProjectWithDependencies reports unavailable images clearly", async () => {
  await assert.rejects(
    () =>
      runSymfonyCreateProjectWithDependencies("/workspace/symfony", {
        runCommand: async () => {
          throw new Error("manifest unknown: manifest unknown");
        }
      }),
    /image 'docker\.io\/library\/composer:2\.8\.10' is not available or could not be pulled/i
  );
});

test("classified bootstrap errors identify every public stack ID", async () => {
  const cases = [
    { id: "php-drupal", context: "Drupal project with Podman Composer", image: "docker.io/library/composer:2.8.10" },
    { id: "php-symfony", context: "Symfony project with Podman Composer", image: "docker.io/library/composer:2.8.10" },
    { id: "php-wordpress", context: "WordPress project with Podman", image: wordpressImage },
    { id: "rails7", context: "Rails 7 project with Podman", image: rubyImage },
    { id: "rails7-hotwire", context: "Rails 7 + Hotwire project with Podman", image: generatorImage("rails7-hotwire") }
  ] as const;

  for (const testCase of cases) {
    const definition = findStackDefinition(testCase.id)!;
    await assert.rejects(
      () => runStackGeneratorWithDependencies(definition, `/workspace/${testCase.id}`, {
        runCommand: async () => { throw new Error("manifest unknown: manifest unknown"); }
      }),
      (error: Error) => {
        assert.match(error.message, new RegExp(`'${testCase.id}'`), `${testCase.id} unavailable ID`);
        assert.match(error.message, new RegExp(testCase.context.replaceAll("+", "\\+")), `${testCase.id} unavailable context`);
        assert.ok(error.message.includes(`image '${testCase.image}'`), `${testCase.id} unavailable image`);
        assert.match(error.message, /not available or could not be pulled/i, `${testCase.id} unavailable classification`);
        return true;
      }
    );

    await assert.rejects(
      () => runStackGeneratorWithDependencies(definition, `/workspace/${testCase.id}`, {
        runCommand: async () => { throw new Error("authentication required"); }
      }),
      (error: Error) => {
        assert.match(error.message, new RegExp(`'${testCase.id}'`), `${testCase.id} auth ID`);
        assert.match(error.message, new RegExp(testCase.context.replaceAll("+", "\\+")), `${testCase.id} auth context`);
        assert.ok(error.message.includes(`image '${testCase.image}'`), `${testCase.id} auth image`);
        assert.match(error.message, /requires registry access or authentication/i, `${testCase.id} auth classification`);
        assert.match(error.message, /podman login (?:docker\.io|[^\s]+)/i, `${testCase.id} auth registry hint`);
        return true;
      }
    );
  }
});

test("bootstrap command rendering consumes only the selected definition pins", async () => {
  const base = findStackDefinition("php-drupal")!;
  const selected = {
    ...base,
    generator: {
      kind: "command",
      image: "docker.io/library/composer:9.9.9",
      package: "vendor/project",
      version: "12.34.56",
      command: ["create-project", "{package}:{version}", "."],
      execution: {
        kind: "container",
        context: "Selected project generator",
        mountTarget: "/workspace",
        environment: [{ name: "CACHE_DIR", value: "/tmp/cache" }]
      }
    }
  } satisfies StackDefinition;
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  await runStackGeneratorWithDependencies(selected, "/workspace/selected", {
    runCommand: async (command, args, cwd) => { calls.push({ command, args, cwd }); }
  });

  assert.deepEqual(calls, [{
    command: "podman",
    args: [
      "run", "--rm", ...(process.platform === "linux" ? ["--userns=keep-id"] : []),
      "-e", "CACHE_DIR=/tmp/cache", "-v", "/workspace/selected:/workspace",
      "docker.io/library/composer:9.9.9", "create-project", "vendor/project:12.34.56", "."
    ],
    cwd: "/workspace/selected"
  }]);
});

test("all bootstrap definitions resolve exact packages and gem installs", async () => {
  for (const id of ["php-drupal", "php-symfony", "php-wordpress", "rails7", "rails7-hotwire"] as const) {
    const definition = findStackDefinition(id)!;
    assert.equal(definition.generator.kind, "command", id);
    if (definition.generator.kind !== "command") continue;
    const calls: Array<{ args: string[] }> = [];
    await runStackGeneratorWithDependencies(definition, `/workspace/${id}`, {
      runCommand: async (_command, args) => { calls.push({ args }); }
    });
    const invocation = calls[0]!.args.join(" ");
    assert.ok(calls[0]!.args.includes(definition.generator.image), `${id} image`);
    if (definition.generator.package === "wordpress") {
      assert.match(definition.generator.image, /^ghcr\.io\/loom-development\/loom-wordpress@sha256:[a-f0-9]{64}$/, `${id} published image`);
    } else if (definition.generator.package.includes("/")) {
      assert.match(invocation, new RegExp(`${definition.generator.package.replace("/", "\\/")}:${definition.generator.version.replaceAll(".", "\\.")}(?:\\s|$)`), id);
    } else {
      assert.match(invocation, new RegExp(`gem install ${definition.generator.package} -v ${definition.generator.version.replaceAll(".", "\\.")}(?:\\s|$)`), id);
    }
    for (const install of invocation.matchAll(/gem install ([^&]+)/g)) {
      assert.match(install[1]!, /(?:^|\s)-v\s+\d+\.\d+\.\d+(?:\s|$)/, `${id} exact gem install: ${install[0]}`);
    }
  }
});
