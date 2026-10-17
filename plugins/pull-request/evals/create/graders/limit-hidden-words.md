---
type: regex
target: trace
pattern: 'PR-LIMIT hidden-words=pass(?![\s\S]*PR-LIMIT hidden-words=)'
match: contains
---
The last body the session handed to a create or edit call stays within the `hiddenWords` limit in `pr-body/structure.ts`, from the `PR-LIMIT` line the gh or glab stand-in printed. It fails when no create call reached the stand-in.
