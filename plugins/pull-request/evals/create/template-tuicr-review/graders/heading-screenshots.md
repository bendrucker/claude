---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} Screenshots\s*$'
flags: mi
match: contains
---
The body keeps the template's `Screenshots` heading, in any letter case.
