# GitLab Plugin

GitLab workflow best practices and glab CLI usage for Claude Code.

## Contents

### Skills

- **glab**: CLI basics and GitLab workflow overview
- **merge-request**: Working with merge requests and stacked diffs
- **ci**: CI/CD pipelines and jobs
- **ci-monitor**: Watch an MR's CI and stream state events; invokes the logs agent on failures
- **api**: REST and GraphQL API access
- **docs**: Navigating GitLab documentation
- **todos**: Managing GitLab todos inbox (notifications)

### Agents

- **logs**: Extracts relevant lines from failing-job logs (invoked by `ci-monitor`)

### Hooks

- Transforms GitLab URLs into API requests for better content fetching
- Detects glab OAuth token expiration and provides recovery guidance

## macOS

The `ci-monitor` watch script shells out to `glab`, which fails with `OSStatus -26276` TLS errors under macOS Seatbelt. On macOS, install the `mac` plugin alongside this one. Its sandbox hook recognizes the `claude:dangerouslyDisableSandbox` marker at the top of the watch script and disables Seatbelt for that invocation. Linux users do not need the `mac` plugin.

## Testing

```bash
bun test plugins/gitlab
```
