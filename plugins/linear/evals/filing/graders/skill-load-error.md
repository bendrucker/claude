---
type: regex
target: trace
pattern: 'Shell command (?:permission check )?failed for pattern|Sandbox is required but failed to initialize'
match: not_contains
weight: 3
---
The skill loads without a shell injection error. Its `!` line fails the whole load wherever Bash is denied or the sandbox can't start.
