---
type: regex
target: { source: file, path: src/config.ts }
pattern: 'throw new Error\([^\n]*(configPath|file\.name)'
---
The thrown message now carries the checked path.
