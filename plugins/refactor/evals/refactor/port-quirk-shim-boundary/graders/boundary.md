---
type: regex
pattern: '^boundary: match$'
flags: m
weight: 2
target: { source: file, path: .git/eval/verdicts }
---
invocations next to the `-v=` rule behave as under the loose parser: a separate `-v '=C2+1'` and `--value==C3` keep their leading `=`, `--value='=A1'` stores `=A1`, and `-v==D1` stores `=D1`. The loose parser split only the attached short `-v=` form, once. A shim that strips a leading `=` from every value, or from every short-option value, breaks formulas.
