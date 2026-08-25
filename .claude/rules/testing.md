---
paths:
  - "**/*.test.ts"
  - "**/*.integration.ts"
  - ".github/workflows/**"
---

# Testing

Plugins use `bun test`. Run everything with `bun test`, or filter by plugin with `bun test plugins/<name>`.

After changing a plugin script, run it directly with real arguments as well as its unit tests. Argument parsing and other integration failures only surface at runtime.

## Conventions

- **Integration tests are not auto-discovered.** Bun discovers `*.test.ts`. Run `*.integration.ts` by passing paths explicitly.
- **Prefix dotdir paths with `./`.** A positional arg is a filter, matched against discovered paths, and discovery skips dotdirs. `bun test .claude/hooks` silently runs 0 tests; `bun test ./.claude/hooks` runs them.
- **No `.js` imports in TypeScript.** Import from `./module`, not `./module.js`.
- **Prefer skills over agents** for anything that should be directly invocable. Skills are invocable via the `Skill` tool.
- **Hook E2E tests drive the real dispatcher.** A unit test proves the script's logic, not that Claude Code dispatches to it. Run headless `claude -p` with `--plugin-dir` against a throwaway repo with the external CLI (`gh`, `glab`) stubbed onto `PATH`, then assert on what the stub recorded. These live at `plugins/<name>/scripts/e2e-*.ts` and run in CI only, from a path-filtered workflow holding the `CLAUDE_CODE_OAUTH_TOKEN` secret, because each run spends API tokens.

## Technique Selection

Pick the test shape from the code under test.

#### Repeated Blocks → `test.each`

Collapse two or more `test()` blocks differing only in data into one `test.each` with a typed table. Name each row through the title template so a failure identifies the row without counting.

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

Assert formatted or structured output with `toMatchInlineSnapshot()`. Call it with no argument and the first run writes the received value into the test file. Rerun with `--update-snapshots` when output changes intentionally, and review what it wrote. Never assert structured output field-by-field: one snapshot replaces a run of `expect(x.field).toBe(...)` lines and shows the whole shape in the diff. Exemplar: `plugins/comments/apply/report.test.ts`.

Use a file snapshot (`toMatchSnapshot()`) only when the output exceeds roughly 20 lines or is shared across tests.

#### Statable Invariants → Properties

For pure logic with a statable invariant, write one `fast-check` property plus a small example table for documentation. Invariant shapes: roundtrip (`decode(encode(x))` equals `x`), idempotence, permutation invariance, partition, and agreement with a simpler oracle.

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

Put `expect` calls inside the property. Constrain the arbitrary (`fc.integer({ min: 1 })`) or use `fc.pre(condition)` rather than generating values and filtering them.

#### Fake Domain Instances → Arbitraries and Builders

Give tests that need filler instances of a domain type a typed `fc.record` arbitrary defined next to them. Reuse it in properties, and in example tests via seeded `fc.sample` with per-case fields overridden by spread.

```ts
const finding = fc.record<Finding>({
  path: fc.string({ minLength: 1 }),
  line: fc.integer({ min: 1 }),
  severity: fc.constantFrom("low", "high"),
});

const [base] = fc.sample(finding, { seed: 1, numRuns: 1 });
const item = { ...base, path: "src/a.ts" };
```

A plain `make<Type>(overrides)` builder is fine when only one or two of many fields matter. No faker-style dependencies: realistic-looking values add flake, not signal.

#### Refactor Bar

A test refactor must not change behavior: same assertions, net LOC down, and `bun test <dir>` green before and after.

## CI Structure

Tests run per-plugin in the CI matrix, so failures name the plugin and slow integration tests run in parallel. Root-level tests (`hooks/`) run in a dedicated job.
