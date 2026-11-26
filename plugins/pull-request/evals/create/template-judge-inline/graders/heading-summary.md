---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*^#{2,3} Summary\s*$'
flags: mi
match: contains
---
The body keeps the template's `Summary` heading, in any letter case.
