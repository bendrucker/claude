---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?struct.{0,20}interfaces'
flags: i
match: contains
---
The body keeps the reasoning: `IOStreams` is a struct of interfaces, so a value copy still shares the underlying streams.
