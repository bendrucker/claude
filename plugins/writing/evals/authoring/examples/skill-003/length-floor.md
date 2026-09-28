---
fail: [length-floor, keeps-splits-pwd, keeps-wait-stall, keeps-agent-start-binds-name, keeps-platforms-filter]
---
<out>
---
name: herdr
description: >-
  Drive the herdr terminal workspace manager: inspect workspaces, tabs, and panes, hand work to sibling coding agents in other panes (distinct from in-session `Agent` subagents), split panes for collaborative file viewing or long-running processes, and correlate panes to Claude sessions. Load this when the decision to hand a task to another pane's agent arrives mid-task, and when opening a file alongside the user, starting a dev server or log tail the user should watch, capturing another pane's output, or asking what else is running. Pane, tab, workspace, and split are herdr's terms. A request naming one is a herdr request even when it never says herdr.
argument-hint: "[orient | agents | view <file> | read <pane>]"
allowed-tools:
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/orient.sh)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh)
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
---

# Herdr

herdr manages the terminal workspace this session runs in, including every pane, tab, and sibling coding agent.

Under `HERDR_ENV=1`, a request naming a pane, tab, workspace, or split is about this session's herdr layout. Use tmux only when the user says tmux.

## Command Surface

!`bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh`

For flags not shown above, `herdr <group> <command> --help` is complete: defaults, valid values for every enum flag, preconditions. Where the CLI and this file disagree, the CLI is right and this file is stale.

Bare `herdr` launches or attaches the TUI in this pane. A mutating command in bare form runs on its defaults instead of printing usage, so `herdr workspace create` creates a workspace.

## Current Workspace

!`bash ${CLAUDE_SKILL_DIR}/scripts/orient.sh`

Columns are workspace, then `pane  agent/status  session  cwd  title`, with `cwd` shown only when it differs from the workspace checkout. That view projects `herdr api snapshot`, which returns workspaces, tabs, panes, layouts, and agents in one call. Prefer it to a sequence of `list` calls, and read it raw when the projection is wrong: `herdr api snapshot | jq .`

If the block reports a failure instead of a workspace listing, stop here and use ordinary tools. Nothing below reaches a server.

## Output Formats

Most commands answer with a single-line JSON envelope. Pipe them through `jq -r '.result...'` rather than reading them raw:

```json fragment
{"id":"cli:pane:list","result":{"panes":[...],"type":"pane_list"}}
```

Others print plain text, and `jq` on those dies with `Invalid numeric literal`. Terminal content and human explanations are one kind: `pane read`, `agent read`, `agent explain`. Anything reporting local installation instead of live session state is the other: `plugin list`, `plugin config-dir`, `config check`, `integration status`, `server agent-manifests`.

Exit 1 is a server error with JSON on stderr: parse it. Exit 2 is a syntax error, wrong before it reached the server.

## Addressing

A pane exists whether or not an agent runs in it. `pane` commands drive the raw terminal, and `agent` commands drive the recognized process inside one.

An agent target is a live agent name or the pane ID hosting it, and nothing else. `agent list` prints a `terminal_id` and an `agent` kind beside those, and either one passed as a target yields `agent_not_found`, indistinguishable from a missing agent.

Your own identity comes from the environment, never from inference: `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_SOCKET_PATH`. `HERDR_ENV=1` marks a pane herdr launched.

Name a target on every command that takes one. Use `--current` for the calling pane, an explicit ID otherwise. A pane command with no target may resolve to the UI-focused pane, which can belong to the user or another client.

IDs are opaque handles shaped `w1` for a workspace, `w1:t1` for a tab, and `w1:p1` for a pane. Read them out of responses rather than composing them: `pane split` returns `.result.pane`, `tab create` returns `.result.tab` and `.result.root_pane`, `workspace create` returns all three. Closed IDs are never reused. `pane move` mints a new workspace-qualified pane ID, so tak
</out>
