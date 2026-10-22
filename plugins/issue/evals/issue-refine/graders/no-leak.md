---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?(?:(?<![\w/])tmp/|/tmp/|scratchpad|/Users/|~/|\bmy (?:studio|laptop|machine|checkout|worktree)\b|\bon (?:my|Ben''s) (?:studio|laptop|machine)\b|compare\.ts|hill-climb skill)'
flags: i
match: not_contains
weight: 3
---
The issue, Agent Context included, carries nothing personal to whoever drafted it: no scratch or tmp paths, home paths, the drafter's machine, or the drafter's own skills and tools.
