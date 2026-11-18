---
type: regex
target: { source: file, path: .eval-calls }
pattern: '^claude-dispatch-close park\b.* --pr https://github\.com/acme/relay/pull/\d+'
flags: m
match: contains
---
With a check still pending or failing, the session parked its pane with the PR's URL.
