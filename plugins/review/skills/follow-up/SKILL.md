---
name: review:follow-up
description: >
  Follow up on a PR/MR you reviewed: assess whether the author's fixes actually grasped each
  concern, find silently resolved or mechanically-fixed threads, and get a graded re-review call.
  Use after leaving review feedback to see if the author acted on it.
argument-hint: <pr-url>
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - Bash(git:*)
  - Task
---

# Review Follow-Up

Follow up on my review of: $ARGUMENTS

You are the reviewer. The question is not "did the author reply?" but "did the fix actually grasp
each concern, or just go through the motions?" Status is a signal. The code is the verdict.

All diff and file reading happens in Explore sub-agents. Your main session holds only the structured
verdicts they return, never raw diffs. This keeps my development context free.

## Workflow

### Detect Platform

Parse the URL from `$ARGUMENTS` to determine the platform. GitHub URLs contain `github.com`, GitLab URLs contain the GitLab instance hostname.

#### GitLab

Load the `gitlab:api` and `gitlab:merge-request` skills for API patterns and MR tooling.

### Sync to the Latest Pushed State

Before judging anything, make sure your assessment reflects what the author actually pushed, not a
stale local checkout.

**The worktree-behind-origin trap**: judging a local worktree that is N commits behind origin makes
clean fixes look unaddressed. This is a real near-miss. Never assess local state without syncing.

- Prefer the remote-of-record diff. `glab` and `gh` API diffs always reflect the server, so favor
  them over reading the local worktree.
- If a sub-agent must read the local worktree, it has to `git fetch` first and compare against
  `origin/<branch>`, never the local checkout.

Establish the **review baseline**: the commit/version at which you last reviewed, plus current head.
The fix assessment diffs that range, not the whole MR.

- GitLab: the `gitlab:merge-request` skill exposes MR versions and `diff_refs` to bound the range
  from your last-reviewed version to head.
- GitHub: use your review's commit SHA to head.

### Fetch Threads

Gather all resolvable discussion threads that I started (both resolved and unresolved). Retain each
thread's **original comment body and location**. The sub-agents need the concern's intent, not just
its status.

#### GitHub

Use the `github:pr-comments` skill's script to fetch threads. Run with `--role reviewer` to get threads started by the authenticated user. For resolved threads, use the GraphQL API via `gh api graphql` to query `pullRequest.reviewThreads`, filtering to threads where the first comment author matches the viewer.

#### GitLab

Use the `gitlab:merge-request` skill's discussions tooling to fetch the resolvable threads you
started, both resolved and unresolved. You need each thread's original body, its location, and any
later notes (the author's replies), so pull the full discussion payload, not just the first-note
summary. That skill covers the script, username lookup, and the raw-payload caveat.

### Classify Threads

Sort each thread into one of four buckets, but treat the bucket as a **signal, not a verdict**:

- **Unresolved / no author reply**: Author hasn't responded
- **Unresolved / author replied**: Author responded, evaluate the reply
- **Resolved / with reply**: Author replied and resolved
- **Resolved / silent**: Author resolved without replying

A system-generated note (a version or diff note, not a human comment) is **not** a substantive reply.
Don't count it as the author engaging with the concern. The fetch step's skill covers how these look
on each platform.

The code-grounded verdict from the next step is the source of truth. A mismatch between status and
code reality (resolved but not fixed, unresolved but fixed) is itself a finding.

### Assess Fixes

This is the core step. Dispatch read-only Explore sub-agents (Task tool) to read the post-review diff
and judge each fix. **Group threads by the file they sit on and dispatch one Explore agent per file.**
When a single file carries many threads, fall back to per-thread agents. Cap parallelism sensibly
(roughly 6-8 concurrent).

Give each agent:

- the file path
- every thread on that file: original comment body, location, and the underlying intent
- the review-baseline→head diff range from the sync step

Each agent reads that file's post-review diff **once** and returns a compact structured verdict per
thread. **No raw diffs come back**, only these fields:

- `location`: `file:line` or thread id
- `concern`: the original intent, one line
- `change`: what the author actually did, code-grounded, one line (or "no change found")
- `verdict`: `Addressed` | `Partial` | `Not addressed` | `Dismissed` | `Can't tell`
- `quality`: `Solid` | `Mechanical` (satisfies the words, misses the intent) | `Went further` |
  `Adopted verbatim` | `Workaround/band-aid` | `Introduced new issue` | `n/a` (use when nothing
  changed; quality only applies to a fix that exists)
- `status_mismatch`: e.g. "resolved but not actually fixed", "unresolved but fixed", or none
- `confidence`: `high` | `med` | `low`
- `focus`: boolean, does this warrant my eyes

Spell out these assessment lenses in each agent's prompt:

- Does the fix address the underlying concern, or only the literal surface words?
- Is it partial, fixing one call site but not the others, or handling the happy path only?
- Was it dismissed? If so, is the dismissal reasonable?
- Did the author go further than asked, or adopt my wording verbatim (a sign they fed my comment
  back into a model without engaging)?
- Did the fix introduce a new issue near the change?

### Quick Pass for New Issues

Have the same per-file agents flag problems the fixes **introduced** that aren't tied to any thread.
Real runs always end with this. Surface these separately from the thread verdicts.

### Verify Author Claims

If the author claims they tested, validated, or ran something, check for evidence: relevant commits,
test changes, MR-body checkboxes that are actually checked. Flag unsubstantiated claims rather than
taking them at face value.

### Present: Attention-Ranked Report

Lead with what needs my eyes. Do not emit a uniform full-detail row per thread.

#### Needs your attention

Flagged thread verdicts (`focus = true`), new issues, and unverified claims. Each one concise and
code-grounded, with its confidence. Include any status-vs-reality mismatch.

#### Cleanly addressed

Collapse solid fixes to a count plus one-liners. Don't expand them.

#### Recommendation

A graded call:

- **Approve**: everything addressed cleanly
- **Approve with comments**: addressed, with minor nits you can fix in a follow-up or follow-up PR
- **Request changes**: partial, mechanical, or unaddressed concerns remain

Name the minor-nit lane explicitly: approving while requesting trivial follow-ups is a real option,
not a forced choice between approve and block.

### Execute Actions

After I decide on next steps, use platform-appropriate commands:

#### GitHub

- Approve: `gh pr review --approve`
- Comment: `gh pr comment`
- Resolve thread: `gh api graphql` with `resolveReviewThread` mutation

#### GitLab

Approve, resolve or unresolve threads, and comment via the `gitlab:merge-request` skill.

## Guardrails

- **Check with me** before submitting any review or comments.
- **Don't approve automatically**: present the evidence and let me decide.
- **Flag silently resolved threads** so I can decide whether to reopen or accept.
- **Distinguish code fixes from dismissals**: a resolved thread with matching code changes is different from one resolved with no changes.
- **Sync before judging**: never assess stale local state. Fetch and diff against origin first.
- **Status is a signal, the code is the verdict**: a mismatch between the two is a finding, not noise.
- **Intent over words**: distinguish a fix that meets the concern from one that mechanically satisfies its literal wording.
