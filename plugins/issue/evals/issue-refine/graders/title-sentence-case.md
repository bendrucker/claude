---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n)[\s\S])*?^title:[ \t]*["'']?\S+(?=[^\n]*[ \t][A-Z][a-z][^\n]*[ \t][A-Z][a-z])(?![^\n]*[ \t](?!(?:a|an|the|and|but|or|nor|for|of|in|on|to|with|vs|via|per|at|by|as|from|into|over|under)\b)[a-z])'
flags: m
match: not_contains
---
The title is sentence case: two or more capitalized words after the first, with no lowercase content word, reads as title case (RUBRIC finding 6).
