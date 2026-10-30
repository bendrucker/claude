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
