---
type: regex
pattern: '^#+ *(Changes|Testing|Summary)\b'
flags: im
match: not_contains
---
A small fix is a tight paragraph with no reflexive Changes, Testing, or Summary headings.
