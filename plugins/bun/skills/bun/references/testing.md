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

Use `mock()` to create function mocks:

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

## Snapshot Testing

Compare output to saved snapshots:

```ts
expect(value).toMatchSnapshot();
```

Update snapshots with `--update-snapshots`:

```bash
bun test --update-snapshots
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
