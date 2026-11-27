---
type: regex
pattern: '^behavior: match$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
`bun src/export.ts` prints what `bin/export.sh` prints, and exits the same, for a hidden ledger with a malformed line, with `--sep` and `--currency`, with an option before the file, and for a missing file.
