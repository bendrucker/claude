---
name: bun
description: >-
  Bun runtime patterns and best practices. Use when running scripts with bun,
  using bunx, writing Bun shell scripts, managing bun.lock, or running bun test.
user-invocable: false
---

# Bun

## bunx

Use `--bun` before the executable name to force the Bun runtime over Node shebangs. Use `-p`/`--package` when the binary name differs from the package name (e.g., `bunx -p @angular/cli ng`).

See [references/bunx.md](references/bunx.md)

## Lockfile

`bun.lock` is a text-based lockfile. Resolve merge conflicts by deleting it and running `bun install` to regenerate from scratch — never attempt to merge lockfile contents.

See [references/lockfile.md](references/lockfile.md)

## Resolution

Runtime flags must precede the script path: `bun --cwd ./packages/app run dev`. Never use `.js` extensions in TypeScript imports — Bun resolves them natively.

See [references/resolution.md](references/resolution.md)

## Shell

`Bun.$` is a tagged template for shell execution. Use `.text()` for string output, `.nothrow()` to handle failures without exceptions.

See [references/shell.md](references/shell.md)

## Testing

Bun runs tests in a single process. Set `AGENT=1` to suppress passing test output. Use `--bail` to stop after first failure, `-t` for name filtering.

See [references/testing.md](references/testing.md)
