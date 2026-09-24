---
type: regex
pattern: '^```diff(?:(?!```)[\s\S])*?^ [^\n]*insertAccount'
flags: m
match: contains
---
The diff keeps an unchanged call as context, so it reads as a change to the existing flow.
