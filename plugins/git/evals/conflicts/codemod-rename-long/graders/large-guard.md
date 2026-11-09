---
type: regex
pattern: 'files\.length > 500 \|\| startsUnderAny\(files, alwaysPaths\)'
match: contains
target: { source: file, path: .eval-pushed-tree/src/select.ts }
---
The branch's large-change guard survives under the new name.
