---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

- Avoid using `any` type. Use specific types or `unknown` if necessary.
- Prefer static `import` statements over dynamic `await import()`. There is no reason to defer loading a built-in or first-party module.

## External Data

Everything entering the program is `unknown`: `JSON.parse`, subprocess stdout, file reads, network responses, and hook input on stdin. Validate it against a zod schema where it arrives, and let the schema produce the type.

```ts
const Pr = z.object({ number: z.number(), title: z.string() });
const pr = Pr.parse(JSON.parse(stdout));
```

Describe only the fields the code reads. A schema mirroring an upstream type drifts from it and claims more than the code needs.

An `as` on external data is a promise the compiler cannot check, so a wrong payload runs on undetected and fails somewhere unrelated. Casting to `Record<string, unknown>` and asserting each field with `as string` is the same mistake spread over more lines.

Inside typed code, narrow rather than assert: `typeof`, `instanceof`, `in`, or a `value is T` predicate. Use `satisfies` to check a literal against a type without widening it.
