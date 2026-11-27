---
type: regex
pattern: '^import: match$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
`scripts/import.sh data/budget.csv` writes the same sheet as before, formulas included. It passes each cell's contents as a separate `-v` argument.
