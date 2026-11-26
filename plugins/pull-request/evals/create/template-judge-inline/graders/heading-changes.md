---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} Changes\s*$'
flags: mi
match: contains
---
The body keeps the template's `Changes` heading, in any letter case.
