# Linear Plugin

Managing Linear issues, projects, and teams for Claude Code.

## Contents

### Skills

- **linear** — Workflows, issue management, and API usage

### Hooks

- Guards `save_issue` calls: normalizes input shape, enforces the create/update preconditions, and sets a default state for new issues

## Testing

```bash
npm test -- plugins/linear
```
