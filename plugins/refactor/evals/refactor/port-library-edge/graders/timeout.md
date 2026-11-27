---
type: regex
pattern: '^timeout: same$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
a child that outlives its timeout comes back as before: `timedOut: true` and code 137 from SIGKILL. `Bun.spawn` sends SIGTERM by default, which gives 143.
