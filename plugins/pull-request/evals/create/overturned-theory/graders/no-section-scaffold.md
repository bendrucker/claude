---
type: regex
pattern: '^#+ *(Changes|Testing|Summary)\b'
flags: im
match: not_contains
---
A small fix has no reflexive Changes, Testing, or Summary headings.
