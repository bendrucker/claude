---
type: regex
target: { source: file, path: src/rank.ts }
pattern: 'acct-[0-9a-f]{4}'
match: not_contains
---
The port fixes the cause instead of special-casing the failing corpus accounts.
