---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} What\s*$'
flags: mi
match: contains
---
The body keeps the template's `What` heading, in any letter case.
