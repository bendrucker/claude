---
fail: [length-floor, keeps-machine-forward-scope, keeps-foreign-id-flag, keeps-unreachable-report, keeps-exit1-two-shapes]
---
<out>
---
name: herdr
description: >-
  Drive the herdr terminal workspace manager: inspect workspaces, tabs, and panes, hand work to sibling coding agents in other panes (distinct from in-session `Agent` subagents), split panes for collaborative file viewing or long-running processes, and correlate panes to Claude sessions. Load this when the decision to hand a task to another pane's agent arrives mid-task, and when opening a file alongside the user, starting a dev server or log tail the user should watch, capturing another pane's output, or asking what else is running. Pane, tab, workspace, and split are herdr's terms. A request naming one is a herdr request even when it never says herdr.
argument-hint: "[orient | agents | view <file> | read <pane>]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/orient.ts)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts:*)
  - Bash(herdr api snapshot:*)
  - Bash(herdr --help:*)
  - Bash(herdr agent --help:*)
  - Bash(herdr pane --help:*)
  - Bash(herdr workspace --help:*)
  - Bash(herdr tab --help:*)
  - Bash(herdr plugin --help:*)
  - Bash(herdr worktree --help:*)
  - Bash(herdr agent prompt --help:*)
  - Bash(herdr agent start --help:*)
  - Bash(herdr agent list:*)
  - Bash(herdr agent get:*)
  - Bash(herdr agent read:*)
  - Bash(herdr agent wait:*)
  - Bash(herdr agent explain:*)
  - Bash(herdr pane list:*)
  - Bash(herdr pane get:*)
  - Bash(herdr pane current:*)
  - Bash(herdr pane read:*)
  - Bash(herdr pane layout:*)
  - Bash(herdr pane wait-output:*)
  - Bash(herdr workspace list:*)
  - Bash(herdr worktree list:*)
  - Bash(herdr tab list:*)
  - Bash(herdr plugin list:*)
  - Bash(herdr plugin action list:*)
  - Bash(herdr plugin log list:*)
  - Bash(herdr plugin config-dir:*)
  - Bash(herdr machine list:*)
---

# Herdr

herdr manages the terminal workspace this session runs in, including every pane, tab, and sibling coding agent.

Under `HERDR_ENV=1`, a request naming a pane, tab, workspace, or split is about this session's herdr layout.

## Command Surface

!`bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh`

For flags not shown above, `herdr <group> <command> --help` is complete: defaults, valid values for every enum flag, preconditions. Where the CLI and this file disagree, the CLI is right and this file is stale.

Bare `herdr` launches or attaches the TUI in this pane. A mutating command in bare form runs on its defaults instead of printing usage, so `herdr workspace create` creates a workspace.

## Current Workspace

!`bun ${CLAUDE_SKILL_DIR}/scripts/orient.ts`

Columns are workspace, then `pane  agent/status  session  cwd  title`, with `cwd` shown only when it differs from the workspace checkout. That view projects `herdr api snapshot`, which returns this machine's workspaces, tabs, panes, layouts, and agents in one call. Prefer it to a sequence of `list` calls, and read it raw when the projection is wrong: `herdr api snapshot | jq .
</out>
