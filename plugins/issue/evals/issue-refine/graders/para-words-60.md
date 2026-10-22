---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?(?:^|\n\n)(?![ \t]*(?:[-*+|#>]|\d+[.)]|```))[ \t]*\S+(?:(?:[ \t]+|[ \t]*\n(?![ \t]*(?:\n|[-*+|#>]|\d+[.)]|```))[ \t]*)\S+){60}'
flags: m
match: not_contains
---
No prose paragraph above Agent Context runs past 60 words. Dense paragraphs go into a table, a list, or less text.
