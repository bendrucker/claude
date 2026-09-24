---
type: regex
pattern: 'off[- ]by[- ]one|<= ?items\.length|i < items\.length|out of (bounds|range)'
flags: i
match: contains
---
The review names the loop that reads one past the end of `items`.
