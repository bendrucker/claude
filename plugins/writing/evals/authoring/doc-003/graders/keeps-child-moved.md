---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(child[_ -]?moved(?:(?!\n\n)[\s\S]){0,120}?(not|n''t|unsupported|isn''t|don''t|doesn''t)|(not|n''t|unsupported|isn''t|don''t|doesn''t)(?:(?!\n\n)[\s\S]){0,120}?child[_ -]?moved)'
flags: i
match: contains
---
`child_moved` is called out as unsupported by collection subscriptions.
