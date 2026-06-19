---
name: claude-code:agent-team
description: Orchestrating Claude Code agent teams. Use when creating teams, spawning teammates, assigning tasks, configuring teammate modes, or setting up team quality gate hooks.
argument-hint: "[--plan-approval] [--delegate] [--shutdown]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - WebFetch(domain:code.claude.com)
---

# Agent Teams

## Arguments

These select a team mode up front instead of toggling it interactively (see [Team Lifecycle](#team-lifecycle)):

- `--delegate`: start the lead in delegate mode, coordination-only with no direct implementation. Default: the lead can implement.
- `--plan-approval`: require teammates to plan before implementing, read-only until the lead approves. Default: off.
- `--shutdown`: shut the current team down, teammates first and then the team, then stop. Default: create or operate a team.

## Team Lifecycle

Describe the task and team structure in natural language. Claude creates the team, spawns teammates, and coordinates work.

- **Delegate mode** (Shift+Tab): restricts the lead to coordination-only tools — no direct implementation
- **Plan approval**: require teammates to plan before implementing. The teammate works read-only until the lead approves.
- **Shutdown**: ask the lead to shut down teammates individually, then clean up the team. Always clean up via the lead.

## Task Management

Tasks: pending, in progress, completed. Tasks can depend on other tasks — blocked tasks unlock automatically when dependencies complete.

- **Lead assigns**: tell the lead which task to assign
- **Self-claim**: teammates pick up unassigned, unblocked tasks after finishing
- File locking prevents race conditions on simultaneous claims

## Communication

- **message**: send to one specific teammate
- **broadcast**: send to all teammates (use sparingly — costs scale with team size)
- Messages deliver automatically; the lead doesn't need to poll
- Idle notifications are automatic when a teammate finishes a turn

## Architecture

Teams are stored locally:

- **Team config**: `~/.claude/teams/{team-name}/config.json`
- **Task list**: `~/.claude/tasks/{team-name}/`

The config contains a `members` array with each teammate's name, agent ID, and type. Teammates read this file to discover each other.

Teammates inherit the lead's permission settings at spawn. Each loads project context (CLAUDE.md, MCP servers, skills) plus the spawn prompt — the lead's conversation history does not carry over.

## Limitations

- No session resumption for in-process teammates (`/resume` won't restore them)
- Task status can lag — check and nudge if stuck
- One team per session, no nested teams
- Lead is fixed for the team's lifetime

## Known Issues

- **tmux backend**: teammates spawned in tmux panes may never receive their initial prompt or poll their inbox, causing them to idle indefinitely ([#23415](https://github.com/anthropics/claude-code/issues/23415)). A separate race condition between pane creation and shell initialization can prevent the `claude` command from executing at all ([#25315](https://github.com/anthropics/claude-code/issues/25315)). Use `in-process` backend (the default) as a workaround.

## References

- [references/hooks.md](references/hooks.md) — `TeammateIdle` and `TaskCompleted` quality gate hooks
- [references/practices.md](references/practices.md) — task sizing, spawn prompts, file conflicts, team structures
- [references/interaction.md](references/interaction.md) — display modes, keyboard shortcuts, direct teammate interaction
- [Agent Teams Documentation](https://code.claude.com/docs/en/agent-teams)
