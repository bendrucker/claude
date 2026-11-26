---
type: regex
target: { source: file, path: .dispatch-data/dispatches.jsonl }
pattern: '^(?=[\s\S]*"title":")(?![\s\S]*"title":"(?![A-Z0-9][A-Za-z0-9-]*(?: [A-Z0-9][A-Za-z0-9-]*){1,3}"))'
match: contains
---
The dispatch ledger records at least one session, and every recorded title is two to four Title Case words.
