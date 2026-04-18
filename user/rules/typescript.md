---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

- Avoid using `any` type. Use specific types or `unknown` if necessary.
- Never use double type assertions (`as unknown as T`). Cast to `Record<string, unknown>` once, then assert individual values with `as string` etc., or fix the underlying type.
- Prefer static `import` statements over dynamic `await import()`. There is no reason to defer loading a built-in or first-party module.
