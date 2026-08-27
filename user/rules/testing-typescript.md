---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*_test.ts"
  - "**/*_test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
---

# Testing TypeScript

## Matchers

#### Repeated Cases

Use `test.each` with a typed table. Title each row through the template so a failure names the row.

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

#### Formatted Output

Call `toMatchInlineSnapshot()` with no argument. The first run writes the received value into the test file. When the output changes intentionally, rerun with `-u` and review what it wrote.

Past roughly 20 lines, use `toMatchSnapshot()`, which writes to `__snapshots__/*.snap`.

#### Invariants

Write one `fast-check` property plus a small example table. `fast-check` needs no runner adapter.

```ts
import * as fc from "fast-check";

test("encode/decode roundtrip", () => {
  fc.assert(
    fc.property(fc.array(fc.integer()), (values) => {
      expect(decode(encode(values))).toEqual(values);
    }),
  );
});
```

Put `expect` calls inside the property. An assertion failure or any other throw fails the run, except `fc.pre(condition)`, whose throw skips the case. Constrain the arbitrary (`fc.integer({ min: 1 })`, `fc.string({ minLength: 1 })`) or use `fc.pre` instead of generating values and filtering them.

On failure `fast-check` shrinks toward a smaller counterexample and prints `{ seed, path, endOnFailure }`. Replay by passing that object to `fc.assert(prop, ...)`.

#### Fake Instances

Write a `make<Type>(overrides)` builder in the test file.

```ts
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return { path: "src/a.ts", line: 1, severity: "low", ...overrides };
}
```

Where `fast-check` is already a dependency, define a typed `fc.record` arbitrary beside the tests and reuse it in properties.

```ts
const finding = fc.record<Finding>({
  path: fc.string({ minLength: 1 }),
  line: fc.integer({ min: 1 }),
  severity: fc.constantFrom("low", "high"),
});
```

Skip faker-style dependencies.
