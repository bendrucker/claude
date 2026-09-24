---
fail: [no-file-inventory, no-meta-heading, no-self-narration]
---
<rewrite>
## Things That Wouldn't Be Obvious To A Reviewer

This section covers the non-obvious parts of the change. First, I noticed while working on this that the cast on line 40 was unrequested, but I added it anyway. Second, it's worth noting that the schema asymmetry here is deliberate.

## Changes

- `src/query/build.ts`: added cast
- `src/query/build.test.ts`: added test
- `src/types.ts`: widened type
</rewrite>
