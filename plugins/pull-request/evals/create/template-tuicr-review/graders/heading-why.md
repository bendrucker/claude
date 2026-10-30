---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} Why\s*$'
flags: mi
match: contains
---
The body keeps the template's `Why` heading, in any letter case.
