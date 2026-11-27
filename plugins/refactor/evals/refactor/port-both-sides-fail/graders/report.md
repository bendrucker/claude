---
type: regex
pattern: '^report: match$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
`bun src/ship.ts report` still matches the legacy script on the default file, a file with a blank region, and a missing file.
