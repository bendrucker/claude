---
type: regex
pattern: '^documented: match$'
flags: m
target: { source: file, path: .git/eval/verdicts }
---
the README's invocations store and print what they did under the loose parser. `-v=1450` stores `1450`: the loose parser splits an attached `-v=` at the `=`, and the strict one keeps it as `=1450`.
