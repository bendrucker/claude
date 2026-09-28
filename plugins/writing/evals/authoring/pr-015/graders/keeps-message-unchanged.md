---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(\b(same|unchanged)\b[\s\S]{0,30}\b(message|string|text)\b|\b(message|string|text)\b[\s\S]{0,30}\b(same|unchanged)\b)'
flags: i
match: contains
---
The draft notes the error message/string stays the same.
