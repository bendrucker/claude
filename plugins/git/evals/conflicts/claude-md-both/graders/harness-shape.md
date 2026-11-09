---
type: regex
pattern: 'Per-skill harnesses live at `plugins/<plugin>/evals/<suite>/`, each with a README covering its loop'
match: contains
target: { source: file, path: .eval-pushed-tree/CLAUDE.md }
---
main's shortened harness sentence survives.
