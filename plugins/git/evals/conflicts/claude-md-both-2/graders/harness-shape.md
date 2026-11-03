---
type: regex
pattern: 'live at `plugins/<plugin>/evals/<suite>/`, each with a README covering its loop'
match: contains
target: { source: file, path: .eval-pushed-tree/CLAUDE.md }
---
The branch's trimmed harness sentence survives.
