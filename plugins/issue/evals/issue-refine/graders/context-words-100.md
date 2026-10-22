---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?^##[^\n]*Agent Context[^\n]*\n\s*(?:(?!</issue>)\S)+(?:\s+(?:(?!</issue>)\S)+){100}'
flags: m
match: not_contains
---
Agent Context runs to at most 100 words: links and the few paths that save a search, not every identifier the session touched.
