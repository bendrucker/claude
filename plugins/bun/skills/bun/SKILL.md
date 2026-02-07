---
name: bun
description: >-
  Bun runtime patterns and best practices. Use when running bun commands (bun run, bun test, bunx),
  working with package.json or bun.lock, writing TypeScript scripts that run under Bun,
  developing Claude Code skills/hooks/scripts (which use Bun as their runtime),
  or working in projects that use Bun as their package manager.
  Covers bunx execution, lockfile handling, module resolution, shell scripting with Bun.$,
  subprocess spawning, file I/O, and testing with bun test.
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

`Bun.$` is a tagged template for shell execution. Use response methods (`.text()`, `.json()`, `.lines()`) to extract output, `.nothrow()` to handle failures without exceptions, and pipe/redirect syntax for composing commands.

See [references/shell.md](references/shell.md)

## Subprocess

`Bun.spawn` spawns subprocesses with streaming I/O. Use `Bun.spawnSync` for synchronous execution. Configure stdin/stdout/stderr, environment variables, and working directory. Check `exitCode` for error handling.

See [references/spawn.md](references/spawn.md)

## File I/O

`Bun.file()` creates file handles with `.text()`, `.json()`, `.arrayBuffer()`, and `.stream()` methods. `Bun.write()` writes content to files or stdout/stderr. Both support streaming for large files.

See [references/file-io.md](references/file-io.md)

## Testing

Bun runs tests in a single process. Use `describe`/`it`/`test` for structure, `expect` matchers for assertions, lifecycle hooks (`beforeEach`, `afterEach`) for setup/teardown, `mock()` for function mocking, and `.toMatchSnapshot()` for snapshot testing. Set `AGENT=1` to suppress passing test output.

See [references/testing.md](references/testing.md)
