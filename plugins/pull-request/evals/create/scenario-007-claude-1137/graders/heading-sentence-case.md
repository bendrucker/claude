---
type: regex
pattern: '^#{2,6} [^`\n]*?\S (?!(?:a|an|the|and|or|but|for|to|of|in|on|at|by|via|with|from|into|per|not|no|vs|as|nor|so|yet)\b)[a-z]{2,}\b'
flags: m
match: not_contains
---
Markdown headings title-case their content words, as a label does. The pattern reads prose words up to the first code span, so an identifier never counts as a lowercase word.
