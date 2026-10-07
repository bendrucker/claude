---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:constructors?\b|new (?:packhorse\.)?Pack\s*\(|new (?:packhorse\.)?Package\s*\()'
flags: i
match: contains
---
`packhorse` also exposes the `Pack` and `Package` constructors directly.
