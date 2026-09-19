# Projects

Coordinate parallel agent work: one herdr worktree thread per pull request, an append-only dispatch ledger recording what went out and what came back, and project directories that route requests to a lead.

## Contents

- **Skill**: [`projects`](skills/projects) dispatches a thread, records its outcome, and prints the projects and open threads

## Tests

```bash
bun test plugins/projects
```
