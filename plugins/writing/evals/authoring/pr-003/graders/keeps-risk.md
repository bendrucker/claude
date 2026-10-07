---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(reassign|swap|replace|mutate).{0,60}(streams|out|caller)'
flags: i
match: contains
---
The body keeps the risk: a pointer lets a receiving function reassign the caller's stream and leak the change back out.
