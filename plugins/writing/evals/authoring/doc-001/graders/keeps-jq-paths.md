---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?\.resources\[\*\]'
match: contains
---
The resource/instance counts are shown with a jq-style path like `.resources[*]`.
