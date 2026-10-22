---
type: regex
target: trace
pattern: '"description":"(?:[^"\\]|\\.)*?(?<=\\n|"description":")#{1,6} (?:Possible|Proposed|Suggested|Potential|Next steps|Options|Fix|Solution|Acceptance)'
match: not_contains
---
No fix proposals, next steps, or criteria the request did not supply.
