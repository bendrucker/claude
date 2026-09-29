---
type: regex
pattern: '<rewrite>(?:(?!</rewrite>)[\s\S])*?(?:handleCreate(?:(?!</rewrite>)[\s\S])*handleUpdate|handleUpdate(?:(?!</rewrite>)[\s\S])*handleCreate)'
match: contains
---
Both handlers holding the duplicate survive.
