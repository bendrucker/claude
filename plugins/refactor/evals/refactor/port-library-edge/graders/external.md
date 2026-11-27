---
type: regex
pattern: '^external: same$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
a child killed by SIGKILL from outside the timer returns `timedOut: false` with code 137, which `bin/supervise.ts` retries. Deriving `timedOut` from `signalCode === "SIGKILL"` alone reports it as a timeout, so supervise gives up instead.
