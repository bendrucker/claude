---
type: regex
pattern: '^```[^\n]*\n(?:(?!```)[^\n]*\n){40,}'
flags: m
match: not_contains
---
No code block runs past 40 lines, so the reply proposes a shape rather than an implementation.
