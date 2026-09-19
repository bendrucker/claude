# Projects

Coordinate parallel agent work: one herdr worktree thread per pull request, an append-only dispatch ledger recording what went out and what came back, and project directories that route requests to a lead.

## Contents

- **Agent**: [`chief`](agents/chief.md) triages every request on this machine, routes it to a project's lead or dispatches it as a one-off, and reports what needs a decision. Launch it as its own session: `claude --agent projects:chief --name chief`
- **Skill**: [`projects`](skills/projects) dispatches a thread, records its outcome, prints the projects and open threads, and renders the board
- **Skill**: [`lead`](skills/lead) coordinates one project from its directory, one thread per pull request. Invoked as `/projects:lead <slug>`
- **Hook**: [`chief-compact`](hooks/chief-compact.ts) reprints the ledger after a compaction in a chief session

## Tests

```bash
bun test plugins/projects
```
