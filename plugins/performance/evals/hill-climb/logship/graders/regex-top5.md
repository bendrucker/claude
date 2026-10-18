---
type: regex
pattern: '^\s{0,3}(?:[1-5][.)]|\|\s*[*_`#]*[1-5][*_`]*\s*\|)[^\n]*(MustCompile|regexp\.Compile|compil\w*[^\n]{0,60}reg(ular )?ex|reg(ular )?ex\w*[^\n]{0,60}(compil|hoist)|hoist\w*[^\n]{0,60}reg(ular )?ex)'
flags: im
match: contains
weight: 0.35
---
One of the first five candidates hoists the per-call `regexp.MustCompile`, 24.2% of the profile.
