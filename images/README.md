# Loom image catalog

Loom publishes application runtimes and verified infrastructure mirrors below
`ghcr.io/loom-development`. New stack templates consume immutable manifest
digests from `images/digests.json`; they do not consume the human-readable tags.
Existing projects keep the image references already written to their local
configuration.

## Catalog contents

Custom runtimes are built from the Containerfiles in this directory: PHP and
WordPress, Node 22 and 24, Python 3.12, Ruby 3.3, Bun 1, Java 21, .NET 8, and
SQLite 3, and MySQL 8.4. PostgreSQL, MariaDB, Redis, MongoDB, Elasticsearch, and SQL
Server are unmodified mirrors of digest-pinned upstream manifests.

MySQL preserves the vendor entrypoint and defaults while replacing MySQL Shell’s
bundled certifi with checksum-pinned 2026.10.19 to fix GHSA-6q48-6c7w-9gw2.
Its contract checks the package version and database readiness.

Every entry targets `linux/amd64` and `linux/arm64` unless `platformLimit` in
`catalog.json` records an upstream vendor restriction. SQL Server 2022 is
currently limited to `linux/amd64` by Microsoft.

## Local development

Run the catalog tests with:

```sh
pnpm test:images
```

Build and contract-test a custom runtime with:

```sh
node scripts/images/build.mjs loom-node-24 --platform linux/amd64
node scripts/images/test-image.mjs loom-node-24 localhost/loom-node-24:24.22.2-loom.1
```

Mirror and readiness-test an infrastructure image after authenticating to
GHCR with Podman/Skopeo:

```sh
node scripts/images/mirror.mjs redis-7.4
node scripts/images/test-mirror.mjs redis-7.4 ghcr.io/loom-development/redis-7.4:7.4.12-alpine3.21
```

## Release and update flow

Pull requests build, contract-test, and scan both supported architectures but
cannot publish packages. A merge to protected `main` uses `GITHUB_TOKEN` with
`packages: write` and OIDC permissions to publish manifests, reject fixable
critical vulnerabilities, keyless-sign each digest, and attach build
provenance. The release opens or updates `automation/image-digests` with the
real digest catalog and synchronized stack defaults. Production digests must
never be invented locally.

After reviewing a release, use this maintenance sequence:

```text
release images -> merge automation/image-digests -> pnpm images:sync-stacks -> pnpm verify -> pnpm smoke:published-image
```

The synchronization command regenerates `stacks/published-image-data.ts` and
updates each stack's `loom.yaml`, `.env.example`, and README from its compiled
definition. Running it twice must produce no additional changes.

Every Monday at 09:17 UTC, `images-update.yml` checks whether the registry
digest behind each explicitly pinned upstream tag changed. It reuses
`automation/image-updates` and makes no commit when generated catalog bytes are
unchanged. Version-tag upgrades are intentionally explicit: update the source
tag and Loom version together, then let normal image CI verify the change.

A registry lookup failure stops the update before `catalog.json` is written.
Rerun the workflow after the registry recovers; the last known-good release and
template digests remain untouched.

## Updating images

Keep an image on its cataloged major or LTS line unless a separately reviewed
change intentionally alters application compatibility. Select the newest
stable patch that the vendor has published as a container image. Release notes
alone are insufficient: a documented release can precede its registry
artifact.

1. Read the vendor's release and support documentation. Confirm that the
   candidate is stable, supported, and remains on the intended compatibility
   line.
2. Confirm that the exact tag exists and provides every platform declared in
   `catalog.json`. Do not replace a versioned tag with `latest`, a major-only
   tag, or another floating tag.
3. Resolve the tag's manifest-list digest directly from its authoritative
   registry:

   ```sh
   skopeo inspect --format '{{.Digest}}' docker://docker.io/library/redis:7.4.12-alpine3.21
   skopeo inspect --raw docker://docker.io/library/redis:7.4.12-alpine3.21
   ```

   The first command supplies the `sha256:` value. Inspect the second command's
   platform descriptors and confirm that `linux/amd64` and `linux/arm64` are
   present unless the catalog records a `platformLimit`.
4. Update both `source` and `version` in `catalog.json`. The source must contain
   the exact versioned tag followed by `@sha256:<manifest-digest>`. Do not edit
   published digest values in `stacks/pins.ts` or stack templates by hand. The
   release writes `images/digests.json`, and `pnpm images:sync-stacks` propagates
   the reviewed manifest digest to generated stack assets.
5. Run the catalog and repository verification gates:

   ```sh
   pnpm test:images
   pnpm verify
   ```

6. Open a pull request and let `images-ci.yml` build or copy the image, run its
   public contract or readiness probe, and scan both supported architectures.
7. After merge, inspect every job in `images-release.yml`. A release is complete
   only after readiness, the vulnerability policy, signing, provenance, and the
   digest-catalog update all succeed.

The Monday update workflow only refreshes a digest when an existing pinned tag
is republished. It deliberately does not select new version tags; patch-version
updates require the review above.

Treat a fixable critical vulnerability as an update request first. Upgrade the
base image or vendor tag whenever fixed packages are available. An exception is
appropriate only when the vulnerable code path is demonstrably unreachable
and no fixed upstream artifact exists. Scope an exception with `target` and
`packageName`, record a concrete rationale and owner, and set `expires` no more
than 30 days ahead. Never add a CVE-wide exception for a finding that can also
occur in another binary. The exception file is shared across images: expiration
is enforced when the current scan reports a matching target and package. An
expired scoped exception for an absent finding does not block unrelated images;
it never authorizes a matching finding after its expiration date.

To roll back a bad image update, revert the catalog commit and rerun the release
workflow. Previously published immutable GHCR digests remain available, so
stack templates can continue using the last known-good digest until the
follow-up digest-catalog pull request is reviewed.

To add a new image, preserve the same digest-pinning and platform rules, add its
Containerfile and contract or mirror readiness probe, and run `pnpm verify`.
