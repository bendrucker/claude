---
type: regex
pattern: '\b(?:interface|type)\s+\w+[\s\S]*?^```(?:text|txt|plaintext|diff)?[ \t]*\n(?:(?!```)[\s\S])*?^[ +│├└─]{4,}[A-Za-z_][\w.]*(?:\([^)\n]*\))?(?:\s.*)?$[\s\S]*?[├└]──'
flags: m
match: contains
---
Types come first, then the call tree, then the file layout.
