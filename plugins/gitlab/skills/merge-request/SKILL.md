---
name: gitlab:merge-request
description: Working with GitLab merge requests via glab. Use when creating, updating, reviewing, or merging MRs, enabling auto-merge or merge trains, requesting or re-requesting reviewers, handling approvals, or working review threads, discussions, and draft notes. Load before running any `glab mr` or MR-mutating `glab api` command.
argument-hint: "[create | merge | review | discussions | block] [--draft] [--auto] [--role author|reviewer]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/*:*)
  - Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts:*)
  - Bash(glab mr:*)
  - Bash(glab api:*)
---
# Merge Requests

Scripts directory (absolute, for invocations from other skills where `${CLAUDE_SKILL_DIR}` points elsewhere): !`mkdir -p /tmp/claude/gitlab-skill 2>/dev/null; touch "/tmp/claude/gitlab-skill/${CLAUDE_SESSION_ID}" 2>/dev/null; echo "${CLAUDE_SKILL_DIR}/scripts"`

## Arguments

`$0` (optional verb) routes to a section below. With no verb, infer the operation from the request.

- `create`: open an MR, see [Creating](#creating). `--draft` opens it as a draft.
- `merge`: see [Merging](#merging). `--auto` enables auto-merge (`merge.ts --auto-merge`).
- `review`: see [Reviews](#reviews). `--role reviewer` (default) fetches MRs awaiting your review. `--role author` triages threads on MRs you authored.
- `discussions`: see [Discussions](#discussions).
- `block`: block an MR until another merges, see [blocking.md](blocking.md).

## Merging

Merge only through `merge.ts`. It handles merge trains, auto-merge, and squash. A bare `glab mr merge` turns on auto-merge whenever a pipeline is running. The MR then merges later instead of now. `merge.ts` always sends `--auto-merge=<choice>`.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts feature-branch --auto-merge --squash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts feature-branch --status
```

`--status` prints merge readiness as JSON without mutating the MR: target branch, draft state, `detailed_merge_status`, head pipeline, and `rebased_on_target`, an ancestry check computed from git. Trust `rebased_on_target` over the API's conflict fields, which lag.

#### Re-Arm After a Push

A push cancels queued auto-merge and drops the MR from the merge train. Re-run `merge.ts --auto-merge` after every push to an MR meant to auto-merge. It is idempotent and retries through the `approvals_syncing` window after a push. When `reset_approvals_on_push` is on, also [re-request reviewers](#re-request-reviewers) in the same pass.

To inspect the active train or clear a stuck entry, see [merge-trains.md](merge-trains.md).

## Stacked MRs

Merging one layer of a stack leaves the layer above it targeting the merged branch, and GitLab does not retarget it. After every layer merges, retarget, rebase, and verify the next one per [stacked-mrs.md](stacked-mrs.md).

## Creating

- Push the branch first: `git push -u origin feature-branch && glab mr create --fill`.
- `--fill` populates title and description from commits and cannot combine with `--title`/`--description`.
- Pass a body with `--description-file file.md` (gh's `--body-file` does not exist here) in place of `--description "$(cat file.md)"`, which passes the body through the shell and keeps it out of some hooks.
- `glab mr` has no attach flag. Upload screenshots through project uploads per `gitlab:api` and paste the returned markdown into the description.
- `--reviewer` and `--assignee` silently drop unknown usernames. Resolve exact usernames first, then confirm they appear in `glab mr view`:

```bash
glab api projects/:id/members/all --paginate | jq '.[] | select(.name | test("<name>"; "i")) | {name, username}'
```

## Reviews

Review feedback goes out as draft notes published together, per [review.md](review.md), which also covers the review base, code suggestions, and approvals.

`review-queue.ts` lists MRs awaiting your first review across all projects as `[{ url, reference, title }]`:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/review-queue.ts
```

For the underlying GraphQL, reading review state, and grouping every review-requested MR by next actor, see [review-state.md](review-state.md).

## Re-Request Reviewers

After a push resets approvals, the `mergeRequestReviewerRereview` mutation sets an assigned reviewer's `reviewState` back to `UNREVIEWED`. See [Re-Request Review](review-state.md#re-request-review) for the user-ID lookup and exact mutation.

## Discussions

```bash
# Open threads, one line each
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --resolvable --unresolved --format digest

# Only review-bot threads
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --bots --reviewers=${user_config.reviewers}

bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts resolve <iid> <discussion-id>...
```

See [discussions.md](discussions.md) for the other commands, the JSON schema, and API pitfalls.
