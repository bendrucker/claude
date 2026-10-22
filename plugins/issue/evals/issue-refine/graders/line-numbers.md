---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?(?:#L\d+|\b[\w./-]+\.\w+:\d+|\blines?[ \t]+\d+)'
flags: mi
match: not_contains
weight: 3
---
Above Agent Context, the body cites no line number (`file.py:26-56`, `#L26`, `lines 140-145`) (RUBRIC finding 3).
