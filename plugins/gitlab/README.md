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

- [`register.ts`](mod/register.ts) watches the current branch's merge request and shows its pipeline and approval state at the end of the prompt footer. The model is told when the MR merges or closes, when it conflicts with its target or needs a rebase that the target requires, when its branch moves to a commit the local repository lacks, when a job newly fails, when changes are requested, and when other people approve, revoke an approval, or comment, in one line per author. A conflict alert points at the `git:conflicts` skill and fires even when the conflict is already there as the MR is first seen.
  - **Bot chatter**: a bot's one-line link and its notes led by a hidden `<!--` marker (summaries edited in place, acknowledgements) used to reach the model as comments, and now stay out, judged by shape. A bot's diff note still arrives as a finding. GitLab notes carry no bot flag, so bots are service accounts by name plus the `reviewers` option. Muted notes are logged, not shown, and the `ignore` and `ignoreBody` options mute more.
  - **Whose turn**: the footer used to echo the merge status, and now leads with whom the MR waits on, padded to one width so the glyphs after it hold still: `author`, `agent` while a turn runs, `review`, `merging`, or `ci`. Glyphs with counts follow: failing jobs, reviewers waited on, approvals nobody was asked for, and unresolved threads whose last word is not the session's. A request for changes holds the author's turn until its reviewer is asked again.
  - **Merging**: auto-merge and a merge train show as `merging` with the train position. Leaving the train or auto-merge without merging wakes the model.
  - **`/mr` pane**: the MR title as a link, the footer status in color, then jobs (failing and running ones listed, passing ones counted), review, merge state, and when it polled and polls next. Muted chatter sits behind a collapsed row (`m` toggles it), and `r` reads the MR in full at once. Esc or a second `/mr` closes the pane.
  - **Polling**: a timer chain used to poll every 1 to 10 minutes forever, and one lost timer ended the watch. A wall-clock ticker now runs an overdue poll on the first tick after a wake, backs off to every two hours while nothing changes, and returns to minutes on a change or a turn. Approvals, notes, and jobs are reused while the MR's `updated_at` and pipeline hold.
  - Every decision, send, muted item, turn change, backoff, and late or revived poll is logged to `mod-events`. Needs a signed-in `glab`. Set the `watch` option to false to turn it off

## Testing

```bash
bun test plugins/gitlab
bun scripts/mod-test.ts gitlab
```
