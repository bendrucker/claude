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
- **Prefix dotdir paths with `./` in `bun test`**: A positional arg is a *filter* (substring match against discovered test paths), not a path. Discovery skips dotdirs, so `bun test .claude/hooks` matches nothing and silently runs 0 tests. Writing `bun test ./.claude/hooks` makes bun read it as a path and run the tests under it. Always use a `./` prefix for hidden-dir paths in CI and local test commands.
- **No `.js` imports in TypeScript**: Import from `./module` not `./module.js`. The bundler/runtime handles resolution.
- **Prefer skills over agents**: Skills are invocable via the Skill tool. Agents require the Task tool. If something should be directly invocable, make it a skill.

## Technique Selection

Pick the test shape from the code under test. API patterns for each technique live in [`plugins/bun/skills/bun/references/testing.md`](../../plugins/bun/skills/bun/references/testing.md).

#### Repeated Blocks → `test.each`

When two or more `test()` blocks differ only in data, collapse them into one `test.each` with a typed table (tuple or object rows). Name each row through the title template (`$name` for object rows, `%s`/`%d` for tuples) so a failure identifies the row without counting.

#### Formatted Output → Inline Snapshots

Assert formatted or structured output with `toMatchInlineSnapshot()` by default. Use a file snapshot (`toMatchSnapshot()`) only when the output exceeds roughly 20 lines or is shared across tests. Never assert structured output field-by-field: one snapshot replaces a run of `expect(x.field).toBe(...)` lines and shows the whole shape in the diff. A live exemplar: `plugins/comments/apply/report.test.ts`.

#### Statable Invariants → Properties

For pure logic with a statable invariant, write one `fast-check` property plus a small example table for documentation. Invariant shapes to look for: roundtrip (`decode(encode(x))` equals `x`), idempotence (`f(f(x))` equals `f(x)`), permutation invariance, partition (parts recombine to the whole), and agreement with a simpler oracle. Put `expect` calls inside `fc.property`. Constrain the arbitrary (or use `fc.pre`) instead of generating values and filtering them.

#### Fake Domain Instances → Arbitraries and Builders

When tests need filler instances of a domain type, define a typed `fc.record` arbitrary next to the tests. Reuse it in properties, and in example tests via seeded `fc.sample` with per-case fields overridden by spread. When only one or two of many fields matter, a plain `make<Type>(overrides)` builder in the test file is fine. No faker-style dependencies: types are erased at runtime, and realistic-looking values add flake, not signal.

#### Refactor Bar

Test refactors must not change behavior: same assertions, net LOC down, and `bun test <dir>` green before and after.

## CI Structure

Tests run per-plugin in the CI matrix for:
- **Parallelization**: Integration tests can take seconds; running in parallel across plugins is faster
- **Clear feedback**: Failed tests indicate which plugin has the issue

Root-level tests (e.g., `hooks/`) run in a dedicated job since they're not part of any plugin.
