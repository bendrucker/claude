---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n|</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?(?:(?<![\w/\[`.#=-])(?!(?:ISO|UTF|SHA|RFC)-)(?:[A-Z]{2,}-\d+|MR[ \t]*!\d+|#\d+)|(?<=\s)!\d+)\b(?![^\[\]\n]*\]\()'
flags: m
match: not_contains
weight: 3
---
The body names no issue or PR by a bare number (`TEAM-412`, `!578`, `#123`) outside a link (RUBRIC finding 2).
