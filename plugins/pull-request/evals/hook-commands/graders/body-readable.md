---
type: regex
target: trace
pattern: 'The hook cannot read'
match: not_contains
---
The `validate-body` hook could read every body the session sent, so no call was denied for a body it could not see.
