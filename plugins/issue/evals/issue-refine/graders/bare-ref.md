---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?(?:(?<![\w/\[`.#=-])(?!(?:ISO|UTF|SHA|RFC)-)(?:[A-Z]{2,}-\d+|MR[ \t]*!\d+|#\d+)|(?<=\s)!\d+)\b(?![^\[\]\n]*\]\()'
flags: m
match: not_contains
weight: 3
---
The body names no issue or PR by a bare number (`TEAM-412`, `!578`, `#123`) outside a link (RUBRIC finding 2).
