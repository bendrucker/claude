---
type: regex
pattern: '`bin/archive <dir> <dest>`[\s\S]*`bin/nightly`'
match: contains
target: { source: file, path: .eval-pushed-tree/README.md }
---
The README points at both scripts' final paths.
