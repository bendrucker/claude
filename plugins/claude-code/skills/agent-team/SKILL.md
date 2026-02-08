---
name: claude-code:agent-team
description: Orchestrating Claude Code agent teams. Use when creating teams, spawning teammates, assigning tasks, configuring teammate modes, or setting up team quality gate hooks.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch(domain:code.claude.com)]
---

# Agent Teams

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

Teammates inherit the lead's permission settings at spawn. Each teammate loads project context (CLAUDE.md, MCP servers, skills) plus the spawn prompt — the lead's conversation history does not carry over.

## Limitations

- No session resumption for in-process teammates (`/resume` won't restore them)
- Task status can lag — check and nudge if stuck
- One team per session, no nested teams
- Lead is fixed for the team's lifetime

## References

- [references/hooks.md](references/hooks.md) — `TeammateIdle` and `TaskCompleted` quality gate hooks
- [references/practices.md](references/practices.md) — task sizing, spawn prompts, file conflicts, team structures
- [references/interaction.md](references/interaction.md) — display modes, keyboard shortcuts, direct teammate interaction
- [Agent Teams Documentation](https://code.claude.com/docs/en/agent-teams)
