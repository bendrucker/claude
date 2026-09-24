---
type: regex
pattern: '^```[^\n]*\n(?:(?!```)[^\n]*\n){40,}'
flags: m
match: not_contains
---
No code block runs past 40 lines, so the reply shows the shape rather than rewriting the module.
