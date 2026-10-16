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

#### Repeated Cases

Use `test.each` with a typed table, such as `test.each<{ name: string; input: string }>`. Put each row's identity in the title through `%s`/`%p` or `$field` placeholders.

#### Formatted Output

Call `toMatchInlineSnapshot()` with no argument and let the first run write the value. After an intended change, rerun with `-u` and review what it wrote. Past about 20 lines, use `toMatchSnapshot()` instead.

#### Invariants

Write one `fast-check` property plus a small example table. Put `expect` calls inside the property. Constrain the arbitrary (`fc.integer({ min: 1 })`) or use `fc.pre` instead of generating and filtering. To replay a failure, pass the printed `{ seed, path, endOnFailure }` object as the second argument to `fc.assert`.

#### Fake Instances

Write a `make<Type>(overrides: Partial<Type> = {})` builder in the test file. Where `fast-check` is already a dependency, define a typed `fc.record<Type>` arbitrary beside the tests and reuse it in properties. Do not add faker-style dependencies.
