# GitLab Plugin

GitLab workflow best practices and glab CLI usage for Claude Code.

## Contents

### Skills

- **glab**: CLI basics and GitLab workflow overview
- **merge-request**: Working with merge requests and stacked diffs
- **ci**: CI/CD pipelines and jobs
- **ci-monitor**: Investigate CI pipeline failures and extract failure diagnostics
- **api**: REST and GraphQL API access
- **docs**: Navigating GitLab documentation
- **todos**: Managing GitLab todos inbox (notifications)

### Hooks

- Transforms GitLab URLs into API requests for better content fetching
- Detects glab OAuth token expiration and provides recovery guidance

## Testing

```bash
bun test plugins/gitlab
```
