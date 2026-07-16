# GitLab Plugin

GitLab workflow best practices and glab CLI usage for Claude Code.

## Contents

### Skills

- **merge-request**: Working with merge requests and stacked diffs
- **ci-monitor**: Watch an MR's CI and stream state events, invoking the logs agent on failures. Also covers `.gitlab-ci.yml` authoring and linting
- **api**: REST and GraphQL API access, plus GitLab docs navigation

### Agents

- **logs**: Extracts relevant lines from failing-job logs (invoked by `ci-monitor`)

### Hooks

- Transforms GitLab URLs into API requests for better content fetching
- Detects glab OAuth token expiration and provides recovery guidance
- Denies gh-isms that always fail against GitLab (`glab api --jq`, `gh pr` on a GitLab remote, escaped-`$` inline GraphQL, hallucinated mutations) with the corrected form, and nudges loading `gitlab:merge-request` before hand-rolled MR transactions

## Testing

```bash
bun test plugins/gitlab
```
