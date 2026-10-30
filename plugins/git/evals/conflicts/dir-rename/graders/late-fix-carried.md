---
type: regex
pattern: 'const MAX_TS_MS = 253_402_300_799_999'
match: contains
target: { source: file, path: plugins/observability/skills/session/scripts/telemetry.ts }
---
The branch's last commit, which edits the file under its old path, lands in the renamed file.
