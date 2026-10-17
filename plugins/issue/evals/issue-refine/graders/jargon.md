---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n|</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?\b(?:seam|disposition|leverage|robust|robustly|seamless|utilize|facilitate|holistic|synergy|paradigm|blazing|powerful|cutting-edge|world-class|effortless|delightful|reality)\b'
flags: mi
match: not_contains
---
Above Agent Context, the body uses none of the flagged jargon or marketing words (RUBRIC finding 4).
