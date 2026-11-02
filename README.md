<p align="center">
  <img src="https://raw.githubusercontent.com/Loom-development/Loom/main/assets/branding/devroost-logo.png" alt="Devroost — connected infinity-loop wordmark" width="800">
</p>

# Devroost — local development CLI

Devroost (`devroost` on npm) creates and runs full-stack dev environments with Podman.
Choose a development stack, start it, and work with the source files in your
normal editor. Devroost handles application runtimes, databases, startup order,
health checks, and local HTTPS.

Install the `devroost` package and use the `devroost` command, or run it with
`npx devroost@latest`. Build Node.js, Python, PHP, Ruby, Java, and .NET projects
without Docker Desktop or hand-written container setup.

## What Devroost gives you

- Ready-to-use stacks for Node.js, Python, PHP, Ruby, Java, .NET, databases, and more.
- Project files stored on your computer, where your editor and Git can see them.
- Optional databases configured alongside your application.
- Local HTTPS addresses such as `https://node.devroost.local:8443` when a stack provides a route.
- Startup checks that wait until services are actually ready.
- Safer file ownership when containers write into your project.
- Commands for logs, tests, backups, updates, diagnostics, and cleanup.

Devroost is designed for local development. It is not a production deployment tool.

Projects use `devroost.yaml` for configuration and `.devroost/` for local state.
The GitHub repository and published container registry keep their existing
addresses.

This rename changes project configuration and local-state paths. Existing
projects are not automatically migrated; stop their services with the previous
CLI before moving them to the new format. New projects are generated with the
Devroost names.

## Requirements

- Linux, macOS, or Windows.
- [Node.js](https://nodejs.org/) 24 or newer.
- [Podman](https://podman.io/).
- OpenSSL when you use a stack with a local HTTPS route.

On macOS and Windows, Podman uses a small virtual machine. Devroost starts that
machine automatically when needed.

On Linux and WSL, Podman bridge networks require IPv4 forwarding. Devroost checks
this before starting a project and prints a remediation command if forwarding is
disabled. See [Linux or WSL containers cannot access the internet](#linux-or-wsl-containers-cannot-access-the-internet)
for the one-time host setup and Podman networking recovery steps.

## Install

### From npm

The npm package is named `devroost`; its installed command is `devroost`. Both options
below run the same CLI and require Node.js 24 or newer and Podman.

**For regular use, install globally:**

```bash
npm install --global devroost
devroost --version
devroost --help
```

This installs the `devroost` command for use from any project directory. Update it
when you want a newer release:

```bash
npm install --global devroost@latest
```

**To try Devroost without a global install, use npx:**

```bash
npx devroost@latest --help
```

`npx` downloads the package if needed and stores it in npm's cache. It may ask
before downloading. Use `npx devroost@latest` in place of `devroost` in the examples
throughout this documentation. The `@latest` suffix explicitly requests npm's
latest published release; use a specific version, such as `devroost@0.3.8`, when
you need repeatable runs. See the [npm npx documentation](https://docs.npmjs.com/cli/v11/commands/npx/)
for package selection and caching details.

Internet access is needed to download or update the CLI. Project startup may
also need internet access to pull container images and install application
dependencies, regardless of how you run Devroost.

**Migrating from the previous package name:**

If you installed `@loomdev/cli` globally, replace it with `devroost`:

```bash
npm uninstall --global @loomdev/cli
npm install --global devroost
```

Your project files stay in place, and the command remains `devroost`.

### From a GitHub Release

Linux and macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Loom-development/Loom/main/scripts/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Loom-development/Loom/main/scripts/install.ps1 | iex
```

Check the installation:

```bash
devroost --version
devroost --help
```

## Create your first project

```bash
devroost init node --dir my-app
cd my-app
devroost start
devroost status
```

If you chose `npx`, use this equivalent workflow instead:

```bash
npx devroost@latest init node --dir my-app
cd my-app
npx devroost@latest start
npx devroost@latest status
```

If Devroost asks whether to add a database, choose one or continue without one. When
startup finishes, Devroost prints the addresses it prepared. The Node starter normally
uses `https://node.devroost.local:8443`.

Devroost may ask for permission to add the local hostname. If it cannot, it prints the
entry you can add yourself. Because the HTTPS certificate is created locally, your
browser may ask you to trust it.

When you are done:

```bash
devroost stop
```

With `npx`, stop the project with `npx devroost@latest stop`.

The first start can take a few minutes because Podman may need to download images
and the project may need to install dependencies. Later starts are usually faster.

New projects default to immutable Devroost runtime and database images published at
`ghcr.io/loom-development`. The exact digest is written into `devroost.yaml`, so the
same project uses the same image on every machine. Existing projects are not
rewritten automatically. To choose another compatible image, set the matching
`*_IMAGE` value in the project's `.env` file.

## Your files stay local

Devroost keeps application source, tests, package files, lockfiles, and environment
files in the project directory on your computer. Containers provide the language
runtime and supporting services, then use your local project directory.

This means you can edit, search, test, and commit the project with your usual tools.
Devroost's project records, certificates, and backups are kept under `.devroost/`. Database
files and other persistent service data may live under `data/`. Keep these runtime
directories out of application commits; add them to the project's `.gitignore` if
the chosen stack does not already do so.

```gitignore
.devroost/
data/
```

## Choose a stack

Run `devroost init` without a stack name to choose interactively, or pass one directly:

```bash
devroost init python-django --dir my-site
devroost init php-wordpress --dir my-blog --db mysql
devroost init node-mern --dir my-app
```

### Starter applications

`node`, `bun`, `python`, `php`

### Frameworks and full stacks

`astro`, `django-react`, `dotnet`, `jamstack`, `node-mean`, `node-mern`,
`node-t3`, `php-drupal`, `php-symfony`, `php-wordpress`, `python-django`,
`python-fastapi`, `python-flask`, `rails7`, `rails7-hotwire`, `serverless`,
`spring-boot`, `spring-react`

### Databases

`db-all`, `db-elasticsearch`, `db-mariadb`, `db-mongodb`, `db-mysql`,
`db-postgres`, `db-redis`, `db-sqlite`, `db-sqlserver`

## Add a database

Use `--db` while creating an application. Repeat the option to add more than one:

```bash
devroost init node --dir my-app --db postgres
devroost init python --dir my-api --db mongodb --db redis
```

Optional database choices are `postgres`, `mysql`, `mariadb`, `mongodb`, and
`redis`. Devroost adds the services and connection settings to the generated project.

## Use Devroost with an existing project

Go to the project directory and let Devroost detect the stack:

```bash
cd my-existing-project
devroost adopt
devroost start
```

You can provide the stack when detection is not enough:

```bash
devroost adopt node
```

Adoption adds Devroost configuration without replacing your application source,
package files, lockfiles, or existing environment example.

## Common commands

| Command | What it does |
| --- | --- |
| `devroost start` | Start the application and its services |
| `devroost stop` | Stop this project's services |
| `devroost restart` | Stop and start the project |
| `devroost start --recreate` | Replace the project's containers and start again |
| `devroost status` | Show service and route status |
| `devroost ps` | List this project's containers |
| `devroost logs app` | Follow logs for the `app` service |
| `devroost exec app -- sh` | Open a shell in the `app` service |
| `devroost test` | Run the test task defined by the stack |
| `devroost doctor` | Check the project and local setup for problems |
| `devroost clean --dry-run` | Preview removable dependencies, caches, and builds |
| `devroost upgrade` | Update safe files managed by Devroost |
| `devroost backup <service>` | Back up a database service |
| `devroost restore <service> <file>` | Restore a supported database backup |

Run `devroost <command> --help` to see all options for a command.

## Safe project updates

Devroost records which generated files it owns. `devroost upgrade` updates only those
files when they are unchanged or missing. It does not update application source,
package files, lockfiles, `.env`, or other files that belong to you.

```bash
devroost upgrade
```

If you edited a Devroost-owned file, the command skips it and explains why. Use
`--force-modified` only when you deliberately want to replace those edits.

Projects created by older Devroost releases may need a one-time baseline before their
first upgrade:

```bash
devroost upgrade --initialize-baseline
devroost upgrade
```

## Diagnose problems

```bash
devroost doctor
```

Doctor checks the project, Podman, service images, file ownership, ports, routes,
and local host setup. A warning explains something that may need attention; a
failure identifies something that prevents Devroost from working correctly.

Useful first checks:

```bash
podman info
devroost doctor
devroost status
devroost logs app
```

If the configuration changed but old containers are still present:

```bash
devroost start --recreate
```

### Linux or WSL containers cannot access the internet

If `npm install`, Composer, `pip`, or another dependency download hangs inside a
Devroost service, first check IPv4 forwarding:

```bash
sysctl net.ipv4.ip_forward
```

If it reports `net.ipv4.ip_forward = 0`, enable forwarding for the current
session:

```bash
sudo sysctl -w net.ipv4.ip_forward=1
```

To keep the setting after a restart, create
`/etc/sysctl.d/99-podman-forwarding.conf` containing
`net.ipv4.ip_forward=1`, then run `sudo sysctl --system`.

If forwarding is already enabled but downloads still hang, check that Podman and
its networking components are installed from compatible package sources:

```bash
podman version
apt-cache policy podman netavark aardvark-dns passt
```

Upgrade the networking components together:

```bash
sudo apt update
sudo apt install --only-upgrade netavark aardvark-dns passt
```

On WSL, restart the WSL virtual machine afterward by running the following from
Windows PowerShell, then reopen the Linux terminal:

```powershell
wsl --shutdown
```

Devroost does not change these system-wide settings automatically. They are one-time
host maintenance steps and are not required on macOS or Windows installations
that use Podman Machine.

## Clean generated files safely

Preview cleanup before removing anything:

```bash
devroost clean --dry-run
devroost clean
```

Cleanup is limited to dependency, cache, and build paths declared by the chosen
stack. It does not remove application source, `devroost.yaml`, `.env`, lockfiles,
Devroost's project records, or database data.

## Back up a database

```bash
devroost status                   # find the database service name
devroost backup postgres          # example: app with PostgreSQL
devroost backup db                # example: standalone database stack
devroost backup --all
devroost restore postgres ./.devroost/backups/my-backup.sql
```

Backup supports MySQL, MariaDB, PostgreSQL, MongoDB, Redis, SQLite, and SQL
Server. Restore supports the same databases except SQL Server. Start the database
service before creating or restoring a backup.

## Change a runtime version

Generated projects use tested default image versions. To choose another version,
edit the matching `*_IMAGE` value in the project's `.env` file. Keeping the
choice in `.env` avoids changing `devroost.yaml` directly.

## Get help

- Run `devroost --help` or `devroost <command> --help`.
- Use `devroost doctor` inside a project.
- Report bugs or request features in [GitHub Issues](https://github.com/Loom-development/Loom/issues).

## License

Devroost is available under the [Elastic License 2.0](LICENSE). You may use, copy,
modify, and redistribute Devroost, but the license does not allow offering Devroost itself
to others as a hosted or managed service.
