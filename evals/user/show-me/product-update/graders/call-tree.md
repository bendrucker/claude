---
type: regex
pattern: '^```(?:text|txt|plaintext)?[ \t]*\n(?:(?!```)[\s\S])*?^[ │├└─]{4,}[A-Za-z_][\w.]*(?:\([^)\n]*\))?(?:\s.*)?$'
flags: m
match: contains
---
The flow appears as an indented call tree in a code block.
