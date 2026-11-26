---
type: regex
pattern: 'local bytes=\$\{1:\?size required\}'
match: contains
target: { source: file, path: .eval-pushed-tree/lib/size.sh }
---
The branch's required-argument check is present in the byte-based function.
