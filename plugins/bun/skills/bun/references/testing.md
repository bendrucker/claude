# Testing

Bun's test runner executes all tests in a single process, not worker-per-file like Vitest or Jest.

## Test Structure

Use `describe`, `it`, or `test` to define tests:

```ts
import { describe, it, test, expect } from "bun:test";

describe("math", () => {
  it("adds numbers", () => {
    expect(1 + 1).toBe(2);
  });

  test("multiplies numbers", () => {
    expect(2 * 3).toBe(6);
  });
});
```

## Matchers

Common `expect` matchers:

```ts
// Equality
expect(value).toBe(expected); // strict equality (===)
expect(obj).toEqual(expected); // deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();

// Strings
expect(str).toMatch(/pattern/);
expect(str).toContain("substring");

// Numbers
expect(num).toBeGreaterThan(5);
expect(num).toBeLessThanOrEqual(10);

// Arrays/Objects
expect(arr).toContain(item);
expect(arr).toHaveLength(3);

// Exceptions
expect(() => fn()).toThrow();
expect(() => fn()).toThrow("error message");
expect(() => fn()).toThrow(ErrorClass);

// Negation
expect(value).not.toBe(other);
```

## Lifecycle Hooks

Run setup/teardown code:

```ts
import { beforeEach, afterEach, beforeAll, afterAll } from "bun:test";

beforeAll(() => {
  // Runs once before all tests
});

beforeEach(() => {
  // Runs before each test
});

afterEach(() => {
  // Runs after each test
});

afterAll(() => {
  // Runs once after all tests
});
```

## Mocking

Create function mocks with `mock()`:

```ts
import { mock } from "bun:test";

const fn = mock((a: number, b: number) => a + b);
fn(1, 2);

expect(fn).toHaveBeenCalled();
expect(fn).toHaveBeenCalledWith(1, 2);
expect(fn).toHaveBeenCalledTimes(1);

// Clear call history
fn.mockClear();

// Change implementation
fn.mockImplementation((a, b) => a * b);

// Return specific value
fn.mockReturnValue(42);
```

## Parametrized Tests

`test.each` runs one test per table row. Type the table explicitly so row mistakes fail at compile time:

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

## Snapshot Testing

Prefer inline snapshots. Call the matcher with no argument and bun writes the received value into the test file on the first run:

```ts
expect(render(items)).toMatchInlineSnapshot();

// after the first run, the file contains:
expect(render(items)).toMatchInlineSnapshot(`
"src/a.ts
  :4  trim  restate-the-what  high"
`);
```

File snapshots (`toMatchSnapshot()`) write to `__snapshots__/*.snap` next to the test file. Use them only when the output is too large to inline (roughly 20+ lines) or shared across tests.

When output changes intentionally, rerun with `--update-snapshots` to rewrite both kinds:

```bash
bun test path/to/file.test.ts --update-snapshots
```

## Property-Based Testing

[fast-check](https://fast-check.dev) works under `bun test` with no adapter. Wrap a property in `fc.assert`. On failure it shrinks to a minimal counterexample and prints the seed that reproduces it:

```ts
import fc from "fast-check";
import { expect, test } from "bun:test";

test("encode/decode roundtrip", () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (values) => {
      expect(decode(encode(values))).toEqual(values);
    }),
  );
});
```

- Put `expect` calls inside the property. Any throw fails the run.
- Constrain generation with arbitrary options (`fc.integer({ min: 1 })`, `fc.string({ minLength: 1 })`) or `fc.pre(condition)` rather than generating and filtering.
- Replay a reported failure with `fc.assert(prop, { seed: <printed seed> })`.

Define typed arbitraries for domain types next to the tests and reuse them:

```ts
const finding = fc.record<Finding>({
  path: fc.string({ minLength: 1 }),
  line: fc.integer({ min: 1 }),
  severity: fc.constantFrom("low", "high"),
});

// Seeded sample when an example test needs a filler instance
const [base] = fc.sample(finding, { seed: 1, numRuns: 1 });
const item = { ...base, path: "src/a.ts" };
```

## Key Flags

| Flag | Description |
|------|-------------|
| `--bail` / `--bail=N` | Stop after N failures (default: 1) |
| `-t` / `--test-name-pattern` | Filter by name (regex, not globs) |
| `--update-snapshots` | Update snapshot files |

## Agent Output

Set `AGENT=1` to suppress passing test output while preserving failure details:

```bash
AGENT=1 bun test
```
