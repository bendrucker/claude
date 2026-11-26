# Dispatch

Hand new work to a fresh Claude session in its own worktree, in a Rex tab, a herdr workspace, or a `claude --bg` session.

## Contents

- **Skill**: [`dispatch`](skills/dispatch) creates the worktree with `wt`, writes its `.claude/settings.local.json`, and launches `claude --name <name> <prompt>` in it
- **Skill**: [`close`](skills/close) hands an open PR to a background copy of the session, records the close in the dispatch ledger, and closes the session's Rex or herdr pane

## Tests

`bun test plugins/dispatch` runs the skill's bun tests.
