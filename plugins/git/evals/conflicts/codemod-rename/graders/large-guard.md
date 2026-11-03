---
type: regex
pattern: 'files\.length > 500 \|\| startsUnderAny\(files, alwaysPaths\)'
match: contains
target: { source: file, path: src/select.ts }
---
The branch's large-change guard survives under the new name.
