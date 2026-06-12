# End

The day ends with decisions. Nothing leaves it unsent, unanswered, or unpushed without one.

## Gather

Dispatch parallel read-only sub-agents:

- Outbox: your own PRs/MRs created or pushed today, with reviewer assignment, CI state, draft state, and whether the body still matches the diff.
- Inbound: review requests still open against you, and threads on others' PRs/MRs awaiting your reply.
- Worktrees: every worktree's uncommitted and unpushed state (details under the sweep below).
- Tracker: your in-flight issues and their current states.

## Outbox Clearing

Everything pushed today should leave tonight with:

- A reviewer assigned. Assigning one is safe; respect any reviewer conventions in the config notes.
- A self-review pass before anything new goes out for review. Delegate to an installed code-review skill.
- A body that matches the current diff. When commits have outrun the description, delegate to an installed PR-update skill.

Flag items that need collaboration lead time (a reviewer in another timezone, a long CI run) so they go out tonight rather than tomorrow morning.

## Review Debt

Review debt is inbound requests you did not reach today plus unanswered threads on others' PRs/MRs. Choose one path per item:

- Reply now: draft the reply and include it in the brief. Posting a draft the user approved is safe.
- Carry to tomorrow: record it explicitly so it appears in tomorrow's start brief.

Never silently drop an item.

## Unpushed Work Sweep

Enumerate worktrees via the configured worktree tool. Fall back to `git worktree list` run across the configured roots. For each worktree, report:

- Uncommitted changes (`git status --porcelain`)
- Unpushed commits (`git log @{u}..HEAD --oneline`, or all local commits when no upstream exists)

Offer per worktree: commit and push as WIP (safe on your own branch), or record it as deliberately local in the completion summary.

## Tracker Hygiene and Tomorrow

- Make states match reality: merged work marked done, in-progress only for what is actually in progress. Corrections are safe actions.
- Capture next steps as issue comments or new issues, including monitor and follow-up intents like "when X merges, rebase Y", so tomorrow's start run has a starting point instead of a memory.

## Brief and Act

Assemble the brief in the phase order above and execute per the shared contract in `SKILL.md`.
