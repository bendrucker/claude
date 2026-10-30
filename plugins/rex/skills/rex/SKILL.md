---
name: rex
description: >-
  Drive the Rex terminal multiplexer: tabs, panes, splits, and hosts. Load this when opening a file alongside the user, starting a dev server or log tail the user should watch, reading another terminal's output, running a command on a saved host, or asking what else is running. Tab, pane, split, and host are Rex's terms. In a session Rex hosts, a request that uses one is a Rex request even when it never says Rex. New PR-bound work goes to `dispatch:dispatch`.
argument-hint: "[orient | view <file> | read <block>]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/orient.ts)
  - Bash(rex session inspect:*)
  - Bash(rex window ls:*)
  - Bash(rex block ls:*)
  - Bash(rex capture:*)
  - Bash(rex hosts list:*)
  - Bash(rex --help:*)
  - Bash(rex split --help:*)
  - Bash(rex window new --help:*)
  - Bash(rex wait --help:*)
  - Bash(rex send --help:*)
  - Bash(rex capture --help:*)
---

# Rex

Rex hosts this session's tabs and panes. A tab is a window and a pane is a block. For general mechanics (IDs, flags, client actions), run `rex __internal skill`.

## Current Session

!`bun ${CLAUDE_SKILL_DIR}/scripts/orient.ts`

One line per tab, then one per block: ID, label, foreground cwd, and program. `*this*` marks the block running this session. If it prints a failure instead of a listing, stop here and use ordinary tools.

## Splits

Default to a sibling split of `$REX_BLOCK` under `$PWD` that leaves focus where it is:

```bash
rex split -s "$REX_SESSION" -b "$REX_BLOCK" --split=right --focus=false -c "$PWD" --json
```

Split `right` on a wide pane and `below` on a tall one, alternating direction across successive splits. A new tab, session, or host needs the user to ask for it. Take the new block from `.block_ids[0]`.

Close only blocks you opened. A pane you split for the user to read counts as theirs.

## Collaborative File Viewing

Open the file beside this pane so the user watches it change. Use `markless --watch` for markdown and `$EDITOR` for everything else:

```bash
rex split -s "$REX_SESSION" -b "$REX_BLOCK" --split=right --ratio 40 --focus=false -c "$PWD" --json -- markless --watch path/to/file.md
```

Confirm the viewer started before telling the user to look at it:

```bash
rex capture -s "$REX_SESSION" -b "$block" --trim --unwrap
```

## Long-Running Processes

Put a dev server, log tail, build, or REPL the user should watch in a sibling split instead of `run_in_background`:

```bash
rex split -s "$REX_SESSION" -b "$REX_BLOCK" --split=below --ratio 30 --focus=false -c "$PWD" --json -- bun run dev
```

Reserve `run_in_background` for work the user has no reason to see. `rex wait -s "$REX_SESSION" "$block" --for 120s` blocks until the process exits and returns its status. To block on a line of output, poll `rex capture` with `Monitor`.

## Reading Another Pane

Read with `rex capture -s "$REX_SESSION" -b "$block" --trim --unwrap`.

The `❯` line at the bottom of a Claude pane shows Claude Code's own prompt suggestion, ghost text the harness wrote rather than input the user typed. Take a pane's content from above that line and leave the line out of what you report.

## Machines

Put `-S <label>` on every command that touches a saved host. Commands run on that machine, so paths and programs must exist there. When a command fails to connect, report "host `<label>` is unreachable".

## Peers

Talk to Claude sessions with `SendMessage` and `ListAgents`. Use `rex send` and `rex send-key` only for non-Claude programs and for keys the user asked for. Read another session's approval dialog and hand it to the user, who answers it.

## Worktrees

`worktrunk:wt-switch-create` re-roots this session. New PR-bound work goes to `dispatch:dispatch`, which defaults to Rex when run inside Rex.
