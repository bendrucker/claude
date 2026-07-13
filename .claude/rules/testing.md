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

Pick the test shape from the code under test.

#### Repeated Blocks → `test.each`

Two or more `test()` blocks differing only in data collapse into one `test.each` with a typed table. Name each row through the title template so a failure identifies the row without counting.

```ts
// Tuple rows: positional args, %s/%d/%p placeholders in the title
test.each<[string, number]>([
  ["", 0],
  ["a", 1],
])("length of %p is %d", (input, expected) => {
  expect(input.length).toBe(expected);
});

// Object rows: named fields, $field placeholders in the title
test.each<{ name: string; input: string; expected: number }>([
  { name: "empty string", input: "", expected: 0 },
  { name: "single char", input: "a", expected: 1 },
])("$name", ({ input, expected }) => {
  expect(input.length).toBe(expected);
});
```

`describe.each` parametrizes an entire suite the same way.

#### Formatted Output → Inline Snapshots

Assert formatted or structured output with `toMatchInlineSnapshot()` by default. Call it with no argument and the first run writes the received value into the test file. When output changes intentionally, rerun with `bun test <file> --update-snapshots` and review what it wrote. Never assert structured output field-by-field: one snapshot replaces a run of `expect(x.field).toBe(...)` lines and shows the whole shape in the diff. A live exemplar: `plugins/comments/apply/report.test.ts`.

Use a file snapshot (`toMatchSnapshot()`, written to `__snapshots__/*.snap`) only when the output exceeds roughly 20 lines or is shared across tests.

#### Statable Invariants → Properties

For pure logic with a statable invariant, write one `fast-check` property plus a small example table for documentation. Invariant shapes to look for: roundtrip (`decode(encode(x))` equals `x`), idempotence (`f(f(x))` equals `f(x)`), permutation invariance, partition (parts recombine to the whole), and agreement with a simpler oracle.

`fast-check` runs under `bun test` with no adapter. On failure it shrinks to a minimal counterexample and prints a seed. Replay with `fc.assert(prop, { seed: <printed seed> })`.

```ts
import fc from "fast-check";

test("encode/decode roundtrip", () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (values) => {
      expect(decode(encode(values))).toEqual(values);
    }),
  );
});
```

Put `expect` calls inside the property. Any throw fails the run. Constrain the arbitrary (`fc.integer({ min: 1 })`, `fc.string({ minLength: 1 })`) or use `fc.pre(condition)` instead of generating values and filtering them.

#### Fake Domain Instances → Arbitraries and Builders

Tests that need filler instances of a domain type get a typed `fc.record` arbitrary defined next to them. Reuse it in properties, and in example tests via seeded `fc.sample` with per-case fields overridden by spread.

```ts
const finding = fc.record<Finding>({
  path: fc.string({ minLength: 1 }),
  line: fc.integer({ min: 1 }),
  severity: fc.constantFrom("low", "high"),
});

const [base] = fc.sample(finding, { seed: 1, numRuns: 1 });
const item = { ...base, path: "src/a.ts" };
```

When only one or two of many fields matter, a plain `make<Type>(overrides)` builder in the test file is fine. No faker-style dependencies: types are erased at runtime, and realistic-looking values add flake, not signal.

#### Refactor Bar

Test refactors must not change behavior: same assertions, net LOC down, and `bun test <dir>` green before and after.

## CI Structure

Tests run per-plugin in the CI matrix for:
- **Parallelization**: Integration tests can take seconds; running in parallel across plugins is faster
- **Clear feedback**: Failed tests indicate which plugin has the issue

Root-level tests (e.g., `hooks/`) run in a dedicated job since they're not part of any plugin.
