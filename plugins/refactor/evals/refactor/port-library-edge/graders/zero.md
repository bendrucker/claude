---
type: regex
pattern: '^zero: same$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
`run(cmd, { timeoutMs: 0 })` still kills the child at once and returns `timedOut: true`, which `bin/watch.ts` relies on once its deadline has passed. `Bun.spawn` treats `timeout: 0` as no timeout.
