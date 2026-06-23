# Start

Start-of-work triage: what needs review, what is stuck in your outbox, what came in while you were away, and what today is for.

## Gather

Dispatch parallel read-only sub-agents:

- Inbound: PRs/MRs where the configured username is a requested reviewer or approver, with age, author, and whether you reviewed before.
- Outbox: your own open PRs/MRs, with CI status, unresolved threads, reviewer assignment, and draft state.
- Tracker: issues assigned to the configured user, plus the current cycle as the config expresses it. Record each issue's project, since the brief groups by it. Include the tracker's notification inbox, which is separate from assigned issues.
- Messaging (when configured): direct messages and mentions to the configured user since the last working day that imply an action, with sender, link, and the ask.
- Email (when configured): unhandled mail that needs a reply, an action, or filing, with sender, subject, and link.

Each sub-agent uses the delegated skill, MCP, or CLI for its source and returns structured state: identifiers, links, and statuses the brief can consume directly.

## Inbound Review Queue

Order items blocking others first, then oldest.

Separate fresh requests from re-reviews where the author responded to your earlier feedback. For re-reviews, delegate the addressed-or-not analysis to an installed review-follow-up skill if one exists. Otherwise compare the threads against your prior comments.

Before recommending an action, give each item a one-line summary of what it changes and an estimated review effort. Delegate both to the installed review skill's summary pass when it offers one, so the estimate uses the same effort scale the eventual review would, and the brief never starts the review itself. The estimate is what makes the queue schedulable: it shows the morning's total review load and lets a run of small reviews clear ahead of one deep one.

Recommended actions per item:

- Review today: slot it into the day's order. The review runs through the installed review skill once triage is approved.
- Decline or reassign: ask-first, since it hands work back.

Triage covers the whole queue before any review begins. Reviews are session-length work, so they kick off at the end of the run, after the order is locked.

## Outbox

For each of your open PRs/MRs, flag:

- Failing or stuck CI. Retrying a flaky job is safe. A real failure becomes a candidate focus item. Before planning around a red pipeline, confirm the failure is yours to fix. A shared build break or an upstream outage is not work, and the same job failing identically across several of your MRs is the tell.
- Reviewer threads awaiting your reply. Draft replies and include them in the brief.
- Ready for review but no reviewer assigned. Assigning per the config notes is safe.
- Stale drafts. Recommend one of: finish today (focus item), send as-is (safe), or close (ask-first).

## Inbox Triage

Triage each inbound item, whether a message, a tracker notification, or an email, into an action: a review handoff, a decision you owe someone, a question to answer, or a new task. An item often carries the only signal for a focus item, so a thread that names an MR or issue belongs with that work in the brief, not stranded in a separate inbox list. Map every item to the project it concerns, or to `Misc`.

Inbox zero is the target. Each item leaves the day in a terminal state: handled, deferred to a tracked task, or archived. Drafting a reply the user has read is safe, as is archiving something already handled. Sending a reply without review is ask-first.

## Today Plan

Group everything gathered by project, with a `Misc` group for project-less items. From assignments and the current cycle, propose one to three focus items for the day, folding in anything the earlier phases produced: a real CI failure, a draft to finish, a decision a message asked for.

Confirm two things with the user. First, the focus items. Second, the sequence across projects, because working a project at a time and clearing every review first are both reasonable, and only the user knows which they want today.

Queue tracker corrections as safe actions: stale statuses, items marked in-progress that are not, done work not closed, and issues with no project.

End with a one-line stated goal for the day.

## Brief and Act

Assemble the brief grouped by project per the contract in `SKILL.md`, drawing each item's role from the analysis above. Execute per that shared contract.
