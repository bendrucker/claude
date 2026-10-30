---
type: regex
pattern: 'The model is told when the PR merges or closes'
match: contains
target: { source: file, path: plugins/github/README.md }
---
main's rewritten alert list survives in the GitHub README.
