---
type: regex
pattern: '^(?:(?!```)[\s\S])*```(?:ts|typescript|diff)\b[^\n]*\n(?:(?!```)[\s\S])*?\b(?:interface|type)\s+\w+'
match: contains
---
The first code block in the reply declares types, as TypeScript or as a diff against the existing type, so the design leads with its interface.
