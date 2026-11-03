---
type: regex
pattern: 'Text mined from real PRs, sessions, or work repos lives in the private eval bucket'
match: contains
target: { source: file, path: CLAUDE.md }
---
The branch's rule that mined text lives in the eval bucket survives.
