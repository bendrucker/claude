---
type: regex
pattern: 'Run a native `claude plugin eval` suite through `bun evals/native/run.ts'
match: contains
target: { source: file, path: CLAUDE.md }
---
main's instruction to run native suites through `run.ts` survives.
