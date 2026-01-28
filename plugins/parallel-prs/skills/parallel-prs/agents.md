# Agents

| Agent | Type | Key Constraint |
|-------|------|----------------|
| Planning | `Plan` | Verify paths/line numbers, detect conflicts |
| Implementation | `general-purpose` | Stay in worktree, load `pull-request:create` skill, create PR |
| CI Monitor | `github-actions-monitor` | Report failures with logs |
