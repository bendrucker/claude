---
type: regex
pattern: '^basic: same$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
`run()` returns the same result as before for a failing command and for commands that finish inside their timeout. `proc.killed` is true after a normal exit, so a `timedOut` derived from it fails here.
