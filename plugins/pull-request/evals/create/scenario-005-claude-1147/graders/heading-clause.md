---
type: regex
pattern: '^#{2,6} (?:[^`\n]*,|.*\([^)\n]*,[^)\n]*\)|.*\((?:`[^`\n]*`|(?:Closes|Refs) #\d+)\)[ \t]*$)'
flags: m
match: not_contains
---
Markdown headings stay a single label: no comma-joined clauses, no parenthetical carrying a clause, a file path, or an issue reference.
