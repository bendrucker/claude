---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^wt .* --base \S*feature-x\b
flags: m
match: contains
---
The new worktree is based on the current topic branch, not the default branch.
