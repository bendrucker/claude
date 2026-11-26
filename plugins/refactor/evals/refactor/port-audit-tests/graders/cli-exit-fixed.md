---
type: regex
target: { source: file, path: bin/duration }
pattern: 'exit\(2\)|exitCode\s*=\s*2'
---
The CLI exits 2 on bad input, as the legacy contract says.
