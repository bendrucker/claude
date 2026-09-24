---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:conversation|per your|suggestion|claude|you saw|following up)'
flags: i
match: not_contains
---
No reference to the conversation, the reader's suggestion, or the assistant.
