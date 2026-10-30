---
type: regex
pattern: '^Title:[^\n]*\n\n[\s\S]*?^(?:\s*[-*] |\s*\d+\. |\|[^\n]*\||#{2,} )'
flags: m
match: contains
---
The body organizes its parallel parts with at least one list, table, or heading rather than paragraphs alone.
