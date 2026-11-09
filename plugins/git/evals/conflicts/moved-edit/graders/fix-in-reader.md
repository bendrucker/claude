---
type: regex
pattern: 'replace\(/\\r\$/'
match: contains
target: { source: file, path: .eval-pushed-tree/src/reader.ts }
---
The CRLF fix survives in the moved parser.
