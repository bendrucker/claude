# Start

Start-of-work triage: what needs review, what is stuck in your outbox, and what today is for.

## Gather

Dispatch parallel read-only sub-agents:

- Inbound: PRs/MRs where the configured username is a requested reviewer or approver, with age, author, and whether you reviewed before.
- Outbox: your own open PRs/MRs, with CI status, unresolved threads, reviewer assignment, and draft state.
- Tracker: issues assigned to the configured user, plus the current cycle as the config expresses it.

Each sub-agent uses the delegated skill or CLI for its source and returns structured state: identifiers, links, and statuses the brief can consume directly.

## Inbound Review Queue

Order items blocking others first, then oldest.

Separate fresh requests from re-reviews where the author responded to your earlier feedback. For re-reviews, delegate the addressed-or-not analysis to an installed review-follow-up skill if one exists. Otherwise compare the threads against your prior comments yourself.

Recommended actions per item:

- Review now: start immediately after the brief, via the installed review skill for the configured platform.
- Queue for a time today: record it in the today plan with the chosen slot.
- Decline or reassign: ask-first, since it hands work back.

## Outbox

For each of your open PRs/MRs, flag:

- Failing or stuck CI. Retrying a flaky job is safe. A real failure becomes a candidate focus item.
- Reviewer threads awaiting your reply. Draft replies and include them in the brief.
- Ready for review but no reviewer assigned. Assigning per the config notes is safe.
- Stale drafts. Recommend one of: finish today (focus item), send as-is (safe), or close (ask-first).

## Today Plan

From assignments and the current cycle, propose one to three focus items for the day, folding in anything the earlier phases produced (a real CI failure, a draft to finish). Confirm the list with the user.

Queue tracker corrections as safe actions: stale statuses, items marked in-progress that are not, done work not closed.

End with a one-line stated goal for the day.

## Brief and Act

Assemble the brief in the phase order above and execute per the shared contract in `SKILL.md`.
