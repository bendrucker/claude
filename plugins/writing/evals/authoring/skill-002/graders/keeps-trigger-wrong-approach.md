---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?run to run(?:(?!</out>)[\s\S]){0,150}(?:wrong approach|bad (?:solution )?(?:path|approach))'
flags: i
match: contains
---
The frontmatter description gains a trigger for a prompt that makes the model take the wrong approach.
