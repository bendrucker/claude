---
type: llm
---
Grade only the PR body: the text after the `Title:` line, up to any Claude Code footer. A note to the user before the `Title:` line is not part of the body. Pass when a reviewer holding the diff and the repository can follow the body. Issues, PRs, commits, repository files, skills, symbols, commands, and findings from testing or review may all be named. Fail only when two or more sentences lean on context the repository does not hold: a plan, a session, a conversation, an earlier draft, prior agent turns, or a term the body never defines and the repository would not contain.
