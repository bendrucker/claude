---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^[ \t]*\|[^\n]*\|[ \t]*\n[ \t]*\|[ \t]*:?-{3,}'
flags: m
match: contains
---
The body puts the per-tenant or per-method figures in a markdown table rather than prose.
