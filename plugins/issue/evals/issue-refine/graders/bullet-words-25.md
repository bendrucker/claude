---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?^[ \t]*(?:[-*+]|\d+[.)])[ \t][ \t]*\S+(?:[ \t]+\S+){25}'
flags: m
match: not_contains
---
No bullet above Agent Context runs past 25 words. A list keeps each point terse rather than chopping paragraphs into bullets.
