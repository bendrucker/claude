---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]{300}'
flags: m
match: not_contains
---
The body after the title stays under 300 characters: the change needs a sentence or two, not sections.
