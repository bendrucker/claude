---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} Checklist\s*$'
flags: mi
match: contains
---
The body keeps the template's `Checklist` heading, in any letter case.
