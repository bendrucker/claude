---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?\b(?:seam|disposition|leverage|robust|robustly|seamless|utilize|facilitate|holistic|synergy|paradigm|blazing|powerful|cutting-edge|world-class|effortless|delightful|reality)\b'
flags: mi
match: not_contains
---
Above Agent Context, the body uses none of the flagged jargon or marketing words (RUBRIC finding 4).
