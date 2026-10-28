# GitLab Plugin

GitLab workflow best practices and glab CLI usage for Claude Code.

## Contents

### Skills

- The `merge-request` skill covers working with merge requests
- The `ci-monitor` skill watches an MR's CI and streams state events, invoking the logs agent on failures. It also covers `.gitlab-ci.yml` authoring and linting
- The `api` skill provides REST and GraphQL API access, plus GitLab docs navigation

### Agents

- The `logs` agent extracts relevant lines from failing-job logs and is invoked by `ci-monitor`

### Hooks

- Transforms GitLab URLs into API requests for better content fetching
- Detects glab OAuth token expiration and provides recovery guidance
- Denies gh-isms that always fail against GitLab (`glab api --jq`, `gh pr` on a GitLab remote, escaped-`$` inline GraphQL, hallucinated mutations, an `@<file>` body glab would post as the bare path) with the corrected form, and nudges loading `gitlab:merge-request` before hand-rolled MR transactions

### Mod

- [`register.ts`](mod/register.ts) watches the current branch's merge request and shows its pipeline and approval state at the end of the prompt footer. The model is told when the MR merges or closes, when it conflicts with its target or needs a rebase that the target requires, when its branch moves to a commit the local repository lacks, when a job newly fails, when changes are requested, and when other people approve, revoke an approval, or comment, in one line per author. A conflict alert points at the `git:conflicts` skill and fires even when the conflict is already there as the MR is first seen. Every decision and send is logged to `mod-events`. Needs a signed-in `glab`. Set the `watch` option to false to turn it off

## Testing

```bash
bun test plugins/gitlab
bun scripts/mod-test.ts gitlab
```
