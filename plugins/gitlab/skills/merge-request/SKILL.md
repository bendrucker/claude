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

Working with GitLab merge requests via `glab mr`.

Scripts directory (absolute, for invocations from other skills where `${CLAUDE_SKILL_DIR}` points elsewhere): !`mkdir -p /tmp/claude/gitlab-skill 2>/dev/null; touch "/tmp/claude/gitlab-skill/${CLAUDE_SESSION_ID}" 2>/dev/null; echo "${CLAUDE_SKILL_DIR}/scripts"`

## Arguments

`$0` (optional verb) routes to a section below. With no verb, infer the operation from the request.

- `create`: open an MR. See [Patterns](#patterns). `--draft` opens it as a draft (`glab mr create --draft`).
- `merge`: merge the MR. See [Merging](#merging). `--auto` enables auto-merge (`merge.ts --auto-merge`).
- `review`: review MRs. See [Reviews](#reviews). `--role reviewer` (default) fetches MRs awaiting your review; `--role author` triages threads on MRs you authored.
- `discussions`: work MR discussion threads. See [Discussions](#discussions).
- `block`: block an MR until another merges. See [Blocking](#blocking).

Flag defaults: `--draft` off, `--auto` off, `--role reviewer`.

## Merging

Always use `merge.ts` to merge. It handles merge trains, auto-merge, and squash, falling back to `glab mr merge` internally when appropriate.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts --auto-merge
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts feature-branch --auto-merge --squash
```

Never call `glab mr merge` directly. It turns auto-merge on by default whenever a pipeline is running. A bare invocation then queues the MR to merge itself later instead of merging it now, silently breaking a deliberate merge order. `merge.ts` always sends `--auto-merge=<choice>` so the default cannot apply.

### Inspect Before Merging

`--status` prints the MR's merge readiness as JSON and exits without touching it: target branch, draft state, `detailed_merge_status`, head pipeline, and a `rebased_on_target` ancestry check computed from git rather than the API's stale conflict fields.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts --status
bun ${CLAUDE_PLUGIN_ROOT}/scripts/merge.ts feature-branch --status
```

### Re-Arm Auto-Merge After a Push

Pushing new commits cancels queued auto-merge and drops the MR from the merge train. GitLab does this deliberately so the new commits get a fresh pipeline and review. To keep auto-merge, re-run `merge.ts --auto-merge` after every push that intends to stay armed. The script is idempotent: it treats an already-armed MR as success and retries through the brief `approvals_syncing` window that follows a push, so re-running it is always safe.

A push also resets approvals when `reset_approvals_on_push` is on. Re-trigger review in the same pass, see [Re-request reviewers](#re-request-reviewers).

### Inspect or Recover a Train

To inspect the active train or clear a stuck entry via the API (`glab` has no merge-train command), see [merge-trains.md](merge-trains.md).

## Stacked MRs

Merging one layer of a stack leaves the layer above it targeting a branch that already merged. GitLab does not retarget it. Retarget, rebase, and verify after every layer, see [stacked-mrs.md](stacked-mrs.md).

## Patterns

**Always push before creating:**
```bash
git push -u origin feature-branch && glab mr create --fill
```

**Draft MRs:** Use `--draft` to prevent accidental merges.

**Auto-fill vs custom:** `--fill` auto-populates from commits but cannot combine with `--title`/`--description`. Choose one approach.

**Body from file:** The flag is `--description-file file.md`, not gh's `--body-file`. Prefer it over `--description "$(cat file.md)"`, which passes the body through the shell and keeps it out of some hooks.

**Screenshots:** `glab mr` has no attach flag. Upload each file through project uploads per `gitlab:api` and paste the returned markdown into the description before creating.

**Username resolution:** Flags like `--reviewer` and `--assignee` require exact usernames; invalid names are silently ignored. Look up users first:

```bash
glab api projects/:id/members/all --paginate | jq '.[] | select(.name | test("<name>"; "i")) | {name, username}'
```

## Blocking

Block an MR from merging until another MR merges first (`block` verb). See [blocking.md](blocking.md) for the REST API commands.

## Reviews

Submit review feedback as draft notes that accumulate before publishing. See [review.md](review.md) for the draft notes workflow, code suggestions, and approvals.

Fetch MRs awaiting your first review across all projects (the `UNREVIEWED` bucket; REST's `scope=reviews_for_me` cannot filter by review state). Emits `[{ url, reference, title }]` as JSON:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/review-queue.ts
```

See [review-state.md](review-state.md) for the underlying GraphQL query and filter.

To group all your review-requested MRs by next actor (not just the `UNREVIEWED` slice), see [Review Inbox (Next-Actor Triage)](review-state.md#review-inbox-next-actor-triage) in review-state.md.

## Re-request reviewers

Re-trigger a review after a push reset approvals. The `mergeRequestReviewerRereview` mutation flips the target's `reviewState` back to `UNREVIEWED` and re-surfaces the MR. The reviewer must already be assigned. See [Re-Request Review](review-state.md#re-request-review) for the user-ID lookup and exact mutation.

## Discussions

Fetch, filter, resolve, and summarize MR discussion threads.

```bash
# Open threads, one line each
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --resolvable --unresolved --format digest

# Only review-bot threads
bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts list <iid> --bots

bun ${CLAUDE_SKILL_DIR}/scripts/discussions.ts resolve <iid> <discussion-id>...
```

See [discussions.md](discussions.md) for the other commands, output formats, and pagination pitfalls.
