---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(?:--machine[\s\S]{0,250}plain text|plain text[\s\S]{0,250}--machine)'
flags: i
match: contains
---
Exit 1 now covers two shapes: JSON on stderr from the local server, and plain text from a `--machine` command that could not reach the remote.
