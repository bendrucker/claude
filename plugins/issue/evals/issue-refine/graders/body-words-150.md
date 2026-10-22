---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n\s*(?:(?!</issue>|^##[^\n]*Agent Context)\S)+(?:\s+(?:(?!</issue>|^##[^\n]*Agent Context)\S)+){150}'
flags: m
match: not_contains
---
The body above Agent Context runs to at most 150 words.
