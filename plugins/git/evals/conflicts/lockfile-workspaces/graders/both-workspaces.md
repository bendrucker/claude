---
type: regex
pattern: '"packages/lint"[\s\S]*"packages/stubs"'
match: contains
target: { source: file, path: bun.lock }
---
The lockfile lists both new workspaces.
