---
type: regex
pattern: '\bquick\b[^\n]*\bcareful\b|\bcareful\b[^\n]*\bquick\b'
flags: i
match: contains
---
The body names the old quick/careful modes alongside the change, so the new names do not read as if they always existed. The prompt supplies no reason for the rename, so naming it is the whole check.
