---
type: regex
pattern: 'export function parseView\(stdout: string\)'
match: contains
target: { source: file, path: plugins/github/mod/pr.ts }
---
The branch's PR watcher module survives.
