# Verified runnable examples

This directory intentionally contains no runnable projects yet.

Projects may be added only after a release test proves that the checked-in
project can be started directly, reaches its declared readiness condition,
writes host files with host-aligned ownership, and stops without leaving
project-scoped containers behind.

Stack definitions and generator assets belong under `stacks/`. To try a
published stack, generate a disposable or local project first:

```bash
devroost init <stack-id> --dir my-project
cd my-project
devroost start
```

Install the `loomdev` npm package globally to use `loom`, or replace `devroost` in
these commands with `npx loomdev@latest` to run without a global installation.
See the [installation guide](https://github.com/Devroost-org/devroost#install)
for requirements and update instructions.
