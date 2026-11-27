---
type: regex
target: { source: file, path: test/timesheet.test.ts }
pattern: '\.(skip|todo)\(|toBeDefined\(\)|toBeTruthy\(\)'
match: not_contains
---
No test is skipped or loosened to a presence check.
