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
allowed-tools:
  - Read(${CLAUDE_SKILL_DIR}/references/*)
  - Bash(claude agents:*)
  - Bash(claude --bg:*)
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

With no argument, suggest a mode from the local time above: before the midpoint of the configured working hours (about 13:00 by default) suggests start, after suggests end. On a weekend, suggest nothing and ask. Confirm the suggestion with AskUserQuestion before proceeding.

Arguments beyond the mode are a focus hint ($ARGUMENTS). Weight the brief toward what they name.

## Delegation

This skill never names platforms. The config declares which version-control platform, issue tracker, worktree tool, messaging platform, email account, and optional personal capture inbox the user works with. For each task, find the installed skill covering the configured tool's task and load it for mechanics, falling back to the configured CLI or MCP directly. Stay read-only until the user confirms actions.

Platforms, hostnames, and usernames come only from the config or the user, never from this skill.

## Brief, then act

Both modes follow this contract.

### Gather

Read-only first. The sources are independent (review queue, own PRs, tracker, messaging inbox, email inbox), so dispatch parallel read-only sub-agents and merge their results. Merge on shared identifiers: when items from different sources name the same issue or MR, they are one piece of work and become one brief entry carrying every source's state. The join is the orchestrator's job, keyed on the cross-references each sub-agent returns.

#### Agents

Background Claude sessions may already be working items in the brief. Run `claude agents --json --all` inline in the orchestrator rather than in a sub-agent: it is one command, and the join needs the raw records that a sub-agent summary would flatten. Each record carries `id`, `sessionId`, `name`, `cwd`, `kind`, `startedAt`, `status`, `state`, and, when blocked, `waitingFor`. `state` is `working`, `blocked`, `done`, or `failed`, and is null for interactive sessions.

Join each record to a brief item in this order:

1. A `name` matching the `job:<identifier>` convention below. Exact and structural, so it is the only join that never guesses.
2. A full PR URL in `name`, or an issue key or `#`-prefixed PR number bounded by non-alphanumeric characters and confirmed against the repo `cwd` resolves to. This covers sessions launched by hand. Do not match a bare substring: `#42` occurs inside `#142`, and every repo has a PR numbered 42.
3. `cwd` resolved to a repo, narrowing the candidate items, plus a semantic match of the name text against item titles.

`cwd` is the directory the session launched from. A session that entered a worktree mid-run still reports its launch directory, usually a main checkout, occasionally a path that has since been pruned. Use it to scope candidates by repo. Never derive a branch from it, and never report it as the work.

When an item's session is still unresolved and the user asks about that specific item, fall back to the `claude-code:session` skill's `search` query with the identifier as `query` and the repo as `project`. Never during gather, since it costs a query per item.

Handle three record classes explicitly. Skip any record whose `sessionId` is the current session. Surface `blocked` records, which are waiting on the user and are the reason this source exists. Surface `failed` records, since abandoned work reads as done work otherwise.

### Brief

One prioritized brief, grouped by project. Resolve each item to its project through the tracker: an issue carries its project, and an MR or message inherits the project of the work it references. Collapse an MR, its issue, and any thread about the same work into one entry. Keep a `Misc` group for project-less items.

Within a group, order blocking items first, then oldest. Each item gets an identifier with a link, a one-line state, and a recommended action. The mode's phases set what to surface and label each item's role within its project.

An item with a matched agent gains one line under its existing entry:

```
agent `<short id>` · <state>[ (<waitingFor>)] · <age>
```

A live session (`working`, `blocked`, or an interactive session whose `state` is null) adds a second line, `→ claude --resume <sessionId>`, because resuming it is the action. A `done` or `failed` session gets no resume line. It is history, so the item keeps the action it already had, and the entry carries the `sessionId` as the prior attempt worth reading.

An unmatched agent becomes its own entry only when it still wants something: `blocked`, `failed`, or `working`. Since gather runs with `--all`, unmatched `done` records are completed history and get dropped. Keeping them would fill a prioritized brief with finished work. Group what remains by the repo `cwd` resolves to, or `Misc` when it resolves to none. A blocked agent is blocking work and sorts with it under the ordering rule above.

Close with the mode's cross-project synthesis: the day's sequence, or the night's open decisions. This is the triage gate. The brief covers everything gathered, and nothing executes until the user approves the order. Omit empty groups and never pad. An empty queue is a two-line brief.

### Act

Split recommended actions into two groups:

- Safe: reversible or expected. Assign a reviewer, retry CI, add a reaction or brief acknowledgement, post a reply the user has seen drafted, update tracker status, archive a handled notification or email.
- Ask-first: approve, close, merge, anything hard to walk back. Each needs its own confirmation.

Drive inbound to zero. Every review request, message, notification, and email leaves the run with a terminal disposition: handled, reacted to or briefly acknowledged, deferred to the work tracker as a team-backlog item or to the personal inbox for your own next-steps and reminders when one is configured, or archived. Never stand up a tracker issue in place of a personal capture: when the user says "my inbox" that means the personal inbox, and when the destination is unclear, ask. Nothing stays in an ambiguous unread state. Where a reaction or brief acknowledgement closes a thread, prefer that over a filler reply. Draft a reply only when it carries real content, and keep it terse.

Present safe actions via AskUserQuestion (execute all, pick a subset, or none). Execute through the delegated skills, then give a short summary of what changed.

Run the quick safe actions and tracker corrections first. Session-length work like a review starts only at the end of the run, after the rest is cleared, and never before the approved order from triage.

Never dispatch over an item with a live session. Resuming it is a handoff: surface the resume command and let the user run it, since this skill runs in its own session and cannot attach to another.

A prior session that is `done` or `failed` does not block a fresh dispatch, but when the work needs another pass, name that `sessionId` in the new prompt so the new session can look up what already happened.

Every session this skill dispatches gets `--name "job:<identifier>"`, reusing the identifier from the brief. That is what lets tomorrow's run join by name alone.
