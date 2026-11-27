---
type: regex
pattern: '^rows: match$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
`src/snap.ts` matches `legacy/snap.ts` on the two open rows (an empty directory prints `no snapshots`, a dry run prints `would remove`) and on an ordinary prune and list.
