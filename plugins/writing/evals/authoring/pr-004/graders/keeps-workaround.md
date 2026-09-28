---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(other|existing|already|handled|various|several).{0,40}repo'
flags: i
match: contains
---
The body keeps the precedent: repositories already worked around this by hand before the workflow did it for them.
