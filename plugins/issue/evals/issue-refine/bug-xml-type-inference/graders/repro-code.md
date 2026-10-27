---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?<Amount ?/>'
flags: m
match: contains
---
The body shows the two-file repro as code, in a fenced block holding the empty `<Amount/>` element.
