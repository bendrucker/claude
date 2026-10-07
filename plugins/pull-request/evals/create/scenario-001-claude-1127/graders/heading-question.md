---
type: regex
pattern: '^#{2,6} (?:(?:What|Whether|When|Where|Which)\b|(?:Why|How) [a-z]|Why (?:Not|This)\b|.*[?.][ \t]*$)'
flags: m
match: not_contains
---
Markdown headings name a topic instead of posing the question the section answers or ending as a sentence does.
