---
name: job
description: >
  Daily routines for a corporate software engineering job. Start mode
  triages the inbound review queue, your own open PRs, and the issue
  tracker's plan for today. End mode clears the outbox, surfaces review
  debt, sweeps worktrees for unpushed work, and tidies tracker state for
  tomorrow. Use via /job, /job start, /job end, or /job setup.
argument-hint: "[start | end | setup]"
disable-model-invocation: true
---

# Job

Run a daily work routine: gather state read-only, present one prioritized brief, then execute confirmed bulk actions through installed skills.

## Config

!`cat ~/.config/claude-job-skill/config.json 2>/dev/null || echo CONFIG_MISSING`

If the output above is `CONFIG_MISSING` and the requested mode is not `setup`, run the interview in [references/setup.md](references/setup.md) first, then continue into the requested mode.

## Mode

Requested mode: `$0`. Local time: !`date "+%A %H:%M"`.

- `start`: read [references/start.md](references/start.md)
- `end`: read [references/end.md](references/end.md)
- `setup`: read [references/setup.md](references/setup.md)

With no argument, suggest a mode from the local time above: before about 13:00 suggests start, after suggests end. On a weekend, suggest nothing and ask. Confirm the suggestion with AskUserQuestion before proceeding.

Arguments beyond the mode are a focus hint ($ARGUMENTS). Weight the brief toward what they name.

## Delegation

This skill never names platforms. The config declares which version-control platform, issue tracker, worktree tool, messaging platform, and email account the user works with. For each task:

1. Find the installed skill covering the configured tool's task (the skill for the configured platform's merge requests, the skill for the configured tracker's issues, the skill or MCP for the configured messaging and email inboxes, the skill that runs a review queue) and load it for mechanics.
2. If no installed skill matches, use the configured CLI or MCP directly. Stay read-only until the user confirms actions.

Platforms, hostnames, and usernames come only from the config or the user, never from this skill.

## Brief, then act

Both modes follow this contract.

### Gather

Read-only first. The sources are independent (review queue, own PRs, tracker, messaging inbox, email inbox), so dispatch parallel read-only sub-agents and merge their results.

### Brief

One prioritized brief, grouped by project. Resolve each item to its project through the tracker: an issue carries its project, and an MR or message inherits the project of the work it references. Collapse an MR, its issue, and any thread about the same work into one entry. Keep a `Misc` group for project-less items.

Within a group, order blocking items first, then oldest. Each item gets an identifier with a link, a one-line state, and a recommended action. The mode's phases set what to surface and label each item's role within its project.

Close with the mode's cross-project synthesis: the day's sequence, or the night's open decisions. This is the triage gate. The brief covers everything gathered, and nothing executes until the user approves the order. Omit empty groups and never pad. An empty queue is a two-line brief.

### Act

Split recommended actions into two groups:

- Safe: reversible or expected. Assign a reviewer, retry CI, post a reply the user has seen drafted, update tracker status, archive a handled notification or email.
- Ask-first: approve, close, merge, anything hard to walk back. Each needs its own confirmation.

Drive inbound to zero. Every review request, message, notification, and email leaves the run with a terminal disposition: handled, deferred to a tracked task or issue, or archived. Nothing stays in an ambiguous unread state.

Present safe actions via AskUserQuestion (execute all, pick a subset, or none). Execute through the delegated skills, then give a short summary of what changed.

Run the quick safe actions and tracker corrections first. Session-length work like a review starts only at the end of the run, after the rest is cleared, and never before the approved order from triage.
