---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]{450}'
flags: m
match: not_contains
---
The body after the title stays under 450 characters: the change needs a sentence or two, not sections.
