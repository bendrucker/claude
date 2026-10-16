---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

- Use a specific type or `unknown` instead of `any`.
- Use static `import` statements instead of `await import()` for built-in and first-party modules.

## External Data

Treat everything entering the program as `unknown`: `JSON.parse`, subprocess stdout, file reads, network responses, and hook input on stdin. Validate it with a zod schema where it arrives, and take the type from the schema. In a module that must stay dependency-free, validate with a `value is T` predicate instead.

```ts
const Pr = z.object({ number: z.number(), title: z.string() });
const pr = Pr.parse(JSON.parse(stdout));
```

Describe only the fields the code reads, since a schema mirroring an upstream type drifts from it.

Never `as`-cast external data. Casting to `Record<string, unknown>` and then each field `as string` counts too.

Inside typed code, narrow with `typeof`, `instanceof`, `in`, or a `value is T` predicate instead of asserting. Use `satisfies` to check a literal against a type without widening it.
