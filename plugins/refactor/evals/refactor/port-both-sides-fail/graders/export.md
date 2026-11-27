---
type: regex
pattern: '^export: match$'
flags: m
weight: 2
target: { source: file, path: .git/eval/verdicts }
---
`bun src/ship.ts export` prints what `legacy/ship.sh export` prints when the carrier answers with rows: dates cut to `YYYY-MM-DD` and cancelled shipments dropped. The harness's carrier stub never finds its recording, so every export input crashed with exit 3 on both sides and the 14/14 never compared a row.
