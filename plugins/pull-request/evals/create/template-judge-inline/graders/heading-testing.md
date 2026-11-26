---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} Testing\s*$'
flags: mi
match: contains
---
The body keeps the template's `Testing` heading, in any letter case.
