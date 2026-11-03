---
type: regex
pattern: 'The model is told when the MR merges or closes'
match: contains
target: { source: file, path: plugins/gitlab/README.md }
---
main's rewritten alert list survives in the GitLab README.
