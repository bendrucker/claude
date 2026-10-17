---
type: regex
pattern: '^\s{0,3}[1-5][.)][^\n]*(Unmarshal|decodeState|map\[string\](any|interface)|decodeRecord|typed struct)'
flags: im
match: contains
weight: 0.31
---
One of the first five candidates decodes into a typed struct instead of `map[string]any`, 11% of the profile.
