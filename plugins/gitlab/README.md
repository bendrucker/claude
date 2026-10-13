# GitLab Plugin

GitLab workflow best practices and glab CLI usage for Claude Code.

## Contents

### Skills

- **merge-request**: Working with merge requests
- **ci-monitor**: Watch an MR's CI and stream state events, invoking the logs agent on failures. Also covers `.gitlab-ci.yml` authoring and linting
- **api**: REST and GraphQL API access, plus GitLab docs navigation

### Agents

- **logs**: Extracts relevant lines from failing-job logs (invoked by `ci-monitor`)

### Hooks

- Transforms GitLab URLs into API requests for better content fetching
- Detects glab OAuth token expiration and provides recovery guidance
- Denies gh-isms that always fail against GitLab (`glab api --jq`, `gh pr` on a GitLab remote, escaped-`$` inline GraphQL, hallucinated mutations) with the corrected form, and nudges loading `gitlab:merge-request` before hand-rolled MR transactions

### Mod

- [`register.ts`](mod/register.ts) watches the current branch's merge request and shows its pipeline and approval state at the end of the prompt footer. A newly failed job or any new approval, unapproval, or comment from someone else reaches the model, and everything is logged to `mod-events`. Needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and a signed-in `glab`

## Testing

```bash
bun test plugins/gitlab
bun scripts/mod-test.ts gitlab
```
