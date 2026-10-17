---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?(?<!\]\(|<)https?://'
flags: m
match: not_contains
---
The body pastes no raw URL outside a markdown link (RUBRIC finding 2).
