---
type: regex
target: { source: file, path: src/checkout.ts }
pattern: 'export function total'
---
The `total` function still exists, so deleting the file does not pass the fix grader.
