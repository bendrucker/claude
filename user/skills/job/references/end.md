# End

The day ends with decisions. Nothing leaves it unsent, unanswered, unfiled, or unpushed without one.

## Gather

Dispatch parallel read-only sub-agents:

- Outbox: your own PRs/MRs created or pushed today, with reviewer assignment, CI state, draft state, and whether the body still matches the diff.
- Inbound: review requests still open against you, and threads on others' PRs/MRs awaiting your reply.
- Messaging (when configured): direct messages, mentions, and tracker notifications awaiting your reply, with sender and link.
- Email (when configured): unhandled mail awaiting your reply or filing, with sender and link.
- Worktrees: every worktree's uncommitted and unpushed state (details under the sweep below).
- Tracker: your in-flight issues, their current states, and their projects.

## Outbox Clearing

Everything pushed today should leave tonight with:

- A reviewer assigned. Assigning one is safe; respect any reviewer conventions in the config notes.
- A body that matches the current diff. When commits have outrun the description, delegate to an installed PR-update skill.

A PR/MR sitting without a reviewer is usually deliberate: doubt about the approach, a blocker, a dependency. Surface it with the likely reason and ask for the next step rather than defaulting to another review pass. Offer a self-review via an installed code-review skill only when the user wants one before sending.

Flag items that need collaboration lead time (a reviewer in another timezone, a long CI run) so they go out tonight rather than tomorrow morning.

## Review Debt

Review debt is inbound requests you did not reach today, unanswered threads on others' PRs/MRs, and any message, notification, or email still awaiting your reply or filing. Choose one path per item:

- Reply now: draft the reply and include it in the brief. Posting a draft the user approved is safe.
- Carry to tomorrow: record it explicitly so it appears in tomorrow's start brief.

Never silently drop an item.

## Unpushed Work Sweep

The configured roots may span many repositories, so keep this phase cheap: one sub-agent, local git commands only, no platform API calls. This is the lowest-priority phase. Skip it when the focus hint points elsewhere or the rest of the brief needs the time.

Enumerate worktrees via the configured worktree tool. Fall back to `git worktree list` run across the configured roots. For each worktree, report:

- Uncommitted changes (`git status --porcelain`)
- Unpushed commits (`git log @{u}..HEAD --oneline`, or all local commits when no upstream exists)

Offer per worktree: commit and push as WIP (safe on your own branch), or record it as deliberately local in the completion summary.

## Tracker Hygiene and Tomorrow

- Make states match reality: merged work marked done, in-progress only for what is actually in progress. Corrections are safe actions.
- Capture next steps as issue comments or new issues, including monitor and follow-up intents like "when X merges, rebase Y", so tomorrow's start run has a starting point instead of a memory.

## Brief and Act

Assemble the brief grouped by project per the contract in `SKILL.md` and execute per that shared contract.
