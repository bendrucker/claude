---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?:(?!\n---\n|</issue>)[\s\S])*?\n---\n(?:(?!</issue>|^##[^\n]*Agent Context)[\s\S])*?(?<!\]\(|<)https?://'
flags: m
match: not_contains
---
The body pastes no raw URL outside a markdown link (RUBRIC finding 2).
