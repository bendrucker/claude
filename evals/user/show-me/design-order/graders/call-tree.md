---
type: regex
pattern: '^```(?:text|txt|plaintext|diff)?[ \t]*\n(?:(?!```)[\s\S])*?^[ +│├└─]{4,}[A-Za-z_][\w.]*(?:\([^)\n]*\))?(?:\s.*)?$'
flags: m
match: contains
---
The design shows how a command runs as an indented call tree.
