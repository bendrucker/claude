---
type: regex
pattern: 'ARCHIVE_KEEP[\s\S]*--exclude=\.git'
match: contains
target: { source: file, path: .eval-pushed-tree/bin/archive }
---
The script sits at `bin/archive`, which takes main's directory and extension convention and the branch's name, and carries both of the branch's edits.
