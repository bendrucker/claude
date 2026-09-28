---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(orphan\w*|untrack\w*|not.{0,15}(tracked|recorded))'
flags: i
match: contains
---
KILL can leave an object created upstream but untracked in state.
