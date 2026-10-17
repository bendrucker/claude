---
type: regex
target: trace
pattern: 'PR-LIMIT max-block=pass(?![\s\S]*PR-LIMIT max-block=)'
match: contains
---
The last body the session handed to a create or edit call stays within the `maxBlockWords` limit in `pr-body/structure.ts`, from the `PR-LIMIT` line the gh or glab stand-in printed. It fails when no create call reached the stand-in.
