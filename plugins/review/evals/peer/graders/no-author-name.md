---
type: regex
pattern: '<comments>(?:(?!</comments>)[\s\S])*?(?:priya|praman|raman|\bthe (?:pr )?author\b)'
flags: i
match: not_contains
---
The comments never name the author, mention their handle, or call them "the author".
