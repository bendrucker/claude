---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(pod|found).{0,60}context.{0,80}(forward|connect|connection).{0,60}context'
flags: is
match: contains
---
The body keeps the two-context split: the pod lookup resolves one context while the forward connection opens with the other.
