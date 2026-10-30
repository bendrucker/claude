---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} How to test\s*$'
flags: mi
match: contains
---
The body keeps the template's `How to test` heading, in any letter case.
