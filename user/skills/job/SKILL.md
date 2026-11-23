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
  - Read(~/.config/claude-job-skill/**)
  - Bash(cat ~/.config/claude-job-skill/config.json)
  - Bash(echo:*)
  - Bash(date:*)
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

This skill never names platforms. The config declares which version-control platform, issue tracker, worktree tool, terminal multiplexer, messaging platform, email account, and optional personal capture inbox the user works with. For each task, find the installed skill covering the configured tool's task and load it for mechanics, falling back to the configured CLI or MCP directly. Stay read-only until the user confirms actions.

Load each delegated skill before the first call to its platform, in the orchestrator and in every gather sub-agent. Name the skill in each gather prompt, and dispatch gather with an agent type that has the `Skill` tool. Connector calls made without the skill fail argument validation.

Platforms, hostnames, and usernames come only from the config or the user, never from this skill.

## Brief, then act

Both modes follow this contract.

### Gather

Read-only first. The sources are independent (review queue, own PRs, tracker, messaging inbox, email inbox), so dispatch parallel read-only sub-agents and merge their results. Merge on shared identifiers: when items from different sources name the same issue or MR, they are one piece of work and become one brief entry carrying every source's state. The join is the orchestrator's job, keyed on the cross-references each sub-agent returns.

#### Reporting

End every gather prompt by naming the report as the agent's final action. An agent that goes idle without a report gets one nudge. Gather runs against a five-minute deadline from dispatch. Past it, or when the nudge produces nothing, stop the agent and run its source inline.

Surface each source's findings as it lands, so a stalled source delays one entry instead of the brief. Hold the merge and the brief entries themselves until every source has reported or been run inline.

#### Agents

Background Claude sessions may already be working items in the brief. Run `claude agents --json --all` inline in the orchestrator, since the join needs the raw records a sub-agent summary would flatten. Records join on `sessionId`. A `background` record carries `state` (`working`, `blocked`, `done`, or `failed`, plus `waitingFor` when blocked), and an `interactive` record carries `status` instead.

When the config names a multiplexer, load its skill to map live sessions to the panes running them by `sessionId`, and record the matched pane on the brief item. Match panes only by `sessionId`, never by title or `cwd`.

Join a record to a brief item by a full PR URL in its `name`, or by an issue key or `#`-prefixed PR number bounded by non-alphanumeric characters and confirmed against the repo `cwd` resolves to. Match whole identifiers only, since `#42` occurs inside `#142`. Failing that, narrow candidates to the repo `cwd` resolves to and match the name text against item titles. `cwd` is the directory the session launched from, so use it to scope by repo and never report it as the work.

Skip the record for the current session. Surface `blocked` records, which are waiting on the user, and `failed` records, since abandoned work reads as done work otherwise.

### Brief

One prioritized brief, grouped by project. Resolve each item to its project through the tracker: an issue carries its project, and an MR or message inherits the project of the work it references. Collapse an MR, its issue, and any thread about the same work into one entry. Keep a `Misc` group for project-less items.

Within a group, order blocking items first, then oldest. Each item gets an identifier with a link, a one-line state, and a recommended action. The mode's phases set what to surface and label each item's role within its project.

#### Next actor

Every review-queue item, outbox item, and discussion thread resolves to a next actor before it earns a place in the brief. The test is who the item is waiting on. Items waiting on someone else are dropped.

The user is the next actor when someone asked the user a direct question, when the user has not reviewed the item at all or has not seen the revision now on the branch, when the user's own MR is blocked on something the user owns, or when the item needs a decision that is the user's to make.

Someone else is the next actor when the user commented or reviewed last and nothing the user raised has been answered, when the item is approved or has changes requested and only the author can move it, and when it is blocked on work the user does not own. A thread carrying the user's unanswered comment is waiting on whoever it was addressed to.

An entry collapsing several sources can carry both actors at once. The user wins that tie, because dropping the entry would drop a question addressed to the user. Carry only the parts that resolve to the user into the entry's summary and its recommended action.

A re-review resolves on the revision rather than on its threads. Commits answering the user's earlier feedback make the user the next actor. Threads the author has not answered do not, and they stay out of the item's summary.

Each group ends with a one-line count of what the filter removed, such as `3 items waiting on their authors, not shown`. That count is how the user tells a filtered group from an empty one.

#### Agent lines

An item with a matched agent gains one line under its existing entry:

```
agent `<short id>` · <state>[ (<waitingFor>)] · <age>
```

A live session (`working`, `blocked`, or an interactive session whose `state` is null) adds a second line naming how to get back into it, because that is the action: the multiplexer skill's focus command for a matched pane, otherwise `→ claude --resume <sessionId>`. A `done` or `failed` session gets no action line. The item keeps the action it already had, and the entry carries the `sessionId` as the prior attempt worth reading.

An unmatched agent becomes its own entry when it is `blocked`, `failed`, or `working`, grouped by the repo `cwd` resolves to or `Misc`. A blocked agent sorts with blocking work. Unmatched `done` records are dropped, except that every `done` session still holding a multiplexer pane joins one cleanup entry offering to close those panes as a safe action.

Close with the mode's cross-project synthesis: the day's sequence, or the night's open decisions. This is the triage gate: nothing executes until the user approves the order. Omit groups that gathered nothing. A group whose items all resolved to another actor prints its heading with the count line alone. An empty queue is a two-line brief.

### Act

Split recommended actions into two groups:

- Safe: reversible or expected. Assign a reviewer, retry CI, add a reaction or brief acknowledgement, post a reply the user has seen drafted, correct a tracker status, archive a handled notification or email, close the pane of a finished session.
- Ask-first: approve, merge, close without the evidence below, anything hard to walk back. Each needs its own confirmation.

Closing a tracker issue is safe only on evidence the orchestrator checked itself: that issue's own MR merged, or its acceptance criteria met in the code. A sub-agent reporting a merged MR is evidence about the MR. Confirm the MR belongs to the issue before it becomes evidence about the issue, since a linked MR may belong to a sibling.

Drive inbound to zero. Everything that reached the brief leaves the run with a terminal disposition: handled, reacted to or briefly acknowledged, deferred to the work tracker as a team-backlog item or to the personal inbox for your own next-steps and reminders when one is configured, or archived. When the user says "my inbox", route to the personal inbox, never a tracker issue. When the destination is unclear, ask. Where a reaction or brief acknowledgement closes a thread, prefer that over a filler reply. Draft a reply only when it carries real content, and keep it terse.

#### Questions

Collect the questions that block a dispatch and ask them in one pass, top blockers first, while everything they do not block keeps moving. A background agent's idle notification arrives as a user turn and cancels an open question. Re-ask it, since the interrupt is not an answer.

#### Execution

Present safe actions via AskUserQuestion (execute all, pick a subset, or none). Execute through the delegated skills, then give a short summary of what changed.

Run the quick safe actions and tracker corrections first. Session-length work like a review starts only at the end of the run, after the rest is cleared, and never before the approved order from triage.

Never dispatch over an item with a live session. With a matched pane, confirm, then focus it through the multiplexer skill as the last action for that item, since it moves the user's foreground away from this session. Without one, surface the resume command.

A prior session that is `done` or `failed` does not block a fresh dispatch. When the work needs another pass, name that `sessionId` in the new prompt so the new session can look up what already happened.
