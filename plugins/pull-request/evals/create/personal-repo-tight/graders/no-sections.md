---
type: regex
pattern: '^#+ *(Changes|Testing|Summary)\b'
flags: im
match: not_contains
---
A personal-tier change has no reflexive Changes, Testing, or Summary headings.
