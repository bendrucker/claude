---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?\]\(https://github\.com/example-otel/python-sdk/blob/main/CHANGELOG\.md#1400\)'
flags: m
match: contains
---
The body links the upstream changelog entry inline where it explains the cause.
