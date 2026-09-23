---
type: regex
pattern: '^#{1,6}[ \t]+(?:\S+[ \t]+)*(?!(?:a|an|the|and|or|but|nor|for|of|on|in|to|at|by|vs|via|with|from|as|per)\b)[a-z]'
flags: m
match: not_contains
---
Every Markdown heading is Title Case: no word other than an article, conjunction, or short preposition starts lowercase. Questions and trailing clauses are left to `no-question-headings` and `no-heading-tails`.
