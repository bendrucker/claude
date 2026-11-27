---
type: regex
target: { source: file, path: src/duration.ts }
pattern: 'lastIndex|/[dgimsu]*y[dgimsu]*\b|\$/'
---
The parser rejects trailing garbage, by anchoring or a sticky regex.
