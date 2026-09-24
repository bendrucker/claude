---
type: regex
pattern: '^(?:(?!```)[\s\S])*```(?:ts|typescript)\b[^\n]*\n(?:(?!```)[\s\S])*?\b(?:interface|type)\s+\w+'
match: contains
---
The first code block in the reply is TypeScript declaring types, so the design leads with its interface.
