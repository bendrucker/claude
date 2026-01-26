# Packages

Shared workspace packages used by both user-level hooks and plugin hooks. Each package is registered as a workspace in the root `package.json` and imported by package name.

## Conventions

- Package names use the `@bendrucker/` scope
- Each package has its own `package.json` with subpath exports mapping to TypeScript source files directly (no build step — `tsx` handles execution)
- Tests live alongside source files (`*.test.ts`)
