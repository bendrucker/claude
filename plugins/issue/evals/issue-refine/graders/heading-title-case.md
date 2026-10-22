---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?^#{2,6}[ \t]+(?:\d+[.)][ \t]*)?(?:[a-z]|[^\n]*?[ \t](?!(?:a|an|the|and|but|or|nor|for|of|in|on|to|with|vs|via|per|at|by|as|from|into|over|under)\b)[a-z])'
flags: m
match: not_contains
---
Section headings are title case: no lowercase word outside the small words (RUBRIC finding 1).
