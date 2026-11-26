---
type: regex
target: { source: file, path: .eval-calls }
pattern: ^wt -C \S*/repos/dotfiles switch
flags: m
match: contains
---
The worktree was created in the dotfiles checkout, not the current repo.
