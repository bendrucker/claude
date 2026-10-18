---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n)[\s\S])*?^title:[ \t]*(?:["''][^\n]{82}|[^"''\n][^\n]{80})'
flags: m
match: not_contains
---
The title is at most 80 characters (RUBRIC finding 6).
