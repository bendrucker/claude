---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^claude-dispatch-close close\b(?=.*--handoff)(?=.* --pr https://github\.com/acme/relay/pull/\d+)'
flags: m
match: contains
---
With every check passing, the session ran `close --handoff` with the PR's URL.
