---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?(?:#L\d+|\b[\w./-]+\.\w+:\d+|\blines?[ \t]+\d+)'
flags: mi
match: not_contains
weight: 3
---
Above Agent Context, the body cites no line number (`file.py:26-56`, `#L26`, `lines 140-145`) (RUBRIC finding 3).
