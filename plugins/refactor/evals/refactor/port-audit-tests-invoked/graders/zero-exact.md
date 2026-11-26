---
type: regex
target: { source: file, path: test/duration.test.ts }
pattern: 'formatDuration\(0\)\)\.toBe\(["''`]0s["''`]'
---
Formatting zero asserts the exact `0s` again.
