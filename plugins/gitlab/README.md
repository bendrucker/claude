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

- [`register.ts`](mod/register.ts) watches the current branch's merge request and shows its pipeline and approval state at the end of the prompt footer. The model is told when the MR merges or closes, when it conflicts with its target or needs a rebase that the target requires, when its branch moves to a commit the local repository lacks, when a job newly fails, when changes are requested, and when other people approve, revoke an approval, or comment, in one line per author. A conflict alert points at the `git:conflicts` skill and fires even when the conflict is already there as the MR is first seen.
  - **Bot chatter**: CodeRabbit walkthroughs and "Actions performed" acks and one-line Linear and Jira linkbacks used to reach the model as comments, and now stay out. A bot's diff note still arrives unless it is CodeRabbit's marked ack. The footer counts what was muted since the last push (robot `2`), and the `ignore` and `ignoreBody` options mute more.
  - **Whose turn**: the footer used to echo the merge status, and now says who acts next. A reply arrow names the reviewer whose request for changes holds the author's turn until they are asked again (`↩ @alice`). After a re-request, an hourglass names who is waited on (`⧗ @alice +2`).
  - **Polling**: a timer chain used to poll every 1 to 10 minutes forever, and one lost timer ended the watch. A wall-clock ticker now runs an overdue poll on the first tick after a wake, backs off to every two hours while nothing changes, and returns to minutes on a change or a turn. Approvals, notes, and jobs are reused while the MR's `updated_at` and pipeline hold.
  - Every decision, send, muted item, turn change, backoff, and late or revived poll is logged to `mod-events`. Needs a signed-in `glab`. Set the `watch` option to false to turn it off

## Testing

```bash
bun test plugins/gitlab
bun scripts/mod-test.ts gitlab
```
