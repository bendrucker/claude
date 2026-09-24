---
type: regex
pattern: '^```diff(?:(?!```)[\s\S])*?^\+[^\n]*(?:unchanged|same|equal|hash|===|!==|previous|last)'
flags: mi
match: contains
---
The logic change is a diff whose added lines carry the unchanged-content check.
