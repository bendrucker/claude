---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^wt -C \S*/repos/infra switch
flags: m
match: contains
---
The worktree was created in the infra checkout, not the current repo.
