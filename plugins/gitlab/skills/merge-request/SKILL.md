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

Merge only through `merge.ts`, which handles merge trains, auto-merge, and squash. A bare `glab mr merge` silently enables auto-merge while a pipeline runs.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts feature-branch --auto-merge --squash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts --status 1298 1299 1300
```

`--status` prints a read-only readiness line per MR. Use it after a push or rebase, and trust its git-computed `rebased_on_target` over the API's conflict fields, which lag.

#### Re-Arm After a Push

A push cancels queued auto-merge and drops the MR from the merge train. Re-run `merge.ts --auto-merge` after every push to an MR meant to auto-merge. It is idempotent and retries through the `approvals_syncing` window after a push. When `reset_approvals_on_push` is on, also [re-request reviewers](#re-request-reviewers) in the same pass.

To inspect the active train or clear a stuck entry, see [merge-trains.md](merge-trains.md).

## Stacked MRs

Merging one layer of a stack leaves the layer above it targeting the merged branch, and GitLab does not retarget it. After every layer merges, retarget, rebase, and verify the next one per [stacked-mrs.md](stacked-mrs.md).

## Creating

- Push the branch first: `git push -u origin feature-branch && glab mr create --fill`.
- `--fill` populates title and description from commits and cannot combine with `--title`/`--description`.
- Pass a body with `--description-file file.md`, or `-` for stdin. gh's `--body-file` does not exist here.
- Attach a screenshot or recording with `--attach <path>` (repeatable) on `glab mr create`, `glab mr update`, and `glab mr note create`.
- `--reviewer` and `--assignee` silently drop unknown usernames. Resolve exact usernames first, then confirm they appear in `glab mr view`:

```bash
glab api "projects/:id/members/all?query=<name>" | jq '.[] | {name, username}'
```

## Reviews

Review feedback goes out as draft notes published together, per [review.md](review.md), which also covers the review base, code suggestions, and approvals.

`review-queue.ts` lists MRs awaiting your first review across all projects as `[{ url, reference, title }]`:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/review-queue.ts
```

For the underlying GraphQL, reading review state, and grouping every review-requested MR by next actor, see [review-state.md](review-state.md).

## Re-Request Reviewers

After a push resets approvals, a note holding only `/request_review @user` sets that reviewer's `reviewState` back to `UNREVIEWED`. See [Re-Request Review](review-state.md#re-request-review).

## Discussions

```bash
# Open threads, one line each
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --resolvable --unresolved --format digest

# Only review-bot threads
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --bots --reviewers=${user_config.reviewers}

# Reply in a thread, then resolve it
glab mr note create <iid> --reply <discussion-id> < tmp/reply.md
glab mr note resolve <iid> <discussion-id>
```

See [discussions.md](discussions.md) for the other commands, the JSON schema, and API pitfalls.

## Notes and Raw API

The `glab mr note` commands (`create`, `draft`, `list`, `resolve`, `reopen`) need glab 1.128 or later. Check `glab --version` before relying on them. Every script here takes `-R group/project` to target an MR outside the current checkout.

For any `glab api` call, read [api.md](api.md) first. It covers jq, error bodies, pagination, path encoding, field types, uploads, and GraphQL.
