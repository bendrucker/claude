---
type: regex
target: { source: file, path: src/load.ts }
pattern: 'export async function loadVisits'
---
The loader still exists, so deleting it does not pass the fix grader.
