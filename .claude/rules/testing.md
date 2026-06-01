---
paths:
  - "**/*.test.ts"
  - "**/*.integration.ts"
  - ".github/workflows/**"
---

# Testing

Plugins use `bun test` for tests. Run all tests with `bun test` or filter by plugin with `bun test plugins/<name>`.

After making changes to plugin scripts, run them directly to verify they work end-to-end, not just via unit tests. For example, after editing `plugins/mac/scripts/jxa.ts`, run `bun plugins/mac/scripts/jxa.ts <app> <script>` with real arguments to confirm the CLI works. Unit tests alone may miss integration issues like argument parsing failures that only surface at runtime.

## Conventions

- **`bun test` runs all unit tests**: Bun auto-discovers `*.test.ts` files. Integration tests (`*.integration.ts`) are not auto-discovered and can be run by passing paths explicitly (e.g., `bun test plugins/<name>/tests/file.integration.ts`).
- **No `.js` imports in TypeScript**: Import from `./module` not `./module.js`. The bundler/runtime handles resolution.
- **Prefer skills over agents**: Skills are invocable via the Skill tool. Agents require the Task tool. If something should be directly invocable, make it a skill.

## CI Structure

Tests run per-plugin in the CI matrix for:
- **Parallelization**: Integration tests can take seconds; running in parallel across plugins is faster
- **Clear feedback**: Failed tests clearly indicate which plugin has the issue

Root-level tests (e.g., `hooks/`) run in a dedicated job since they're not part of any plugin.
