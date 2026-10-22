---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?\]\(https://github\.com/example/xml-reader/pull/75\)'
flags: m
match: contains
---
The body links the upstream cardinality-merge PR inline rather than naming it bare or dropping it.
