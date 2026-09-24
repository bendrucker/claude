---
type: regex
target: { source: file, path: src/manifest.ts }
pattern: 'throw new TypeError\("manifest is missing a version"\)'
---
The behavior the user wants pinned is left as it was.
