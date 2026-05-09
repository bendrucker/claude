---
name: tmux
description: Tmux session, window, and pane awareness. Use when the user asks about tmux panes, wants to capture terminal output, send keys to another pane, open a process in a pane, organize panes, navigate windows/sessions, or check for bell/activity notifications.
allowed-tools:
  - "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/layout.sh)"
hooks:
  PreToolUse:
    - matcher: "Bash(tmux:*)"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/scripts/safe-command.sh"
    - matcher: "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/:*)"
      hooks:
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}'
---

# tmux

## Current Pane

!`bash ${CLAUDE_SKILL_DIR}/scripts/pane.sh`

Use `$TMUX_PANE` to identify the current pane and target adjacent ones.

## Layout

!`bash ${CLAUDE_SKILL_DIR}/scripts/layout.sh`

Use `left`/`top` coordinates to resolve spatial references within the current window (LHS = lowest `left`, RHS = highest `left`, top = lowest `top`, bottom = highest `top`). When describing layouts, draw ASCII box diagrams showing pane positions and sizes.

The `Other Panes` section lists panes in other windows and sessions. Its `TARGET` column is ready to use with `-t` (e.g., `tmux capture-pane -t website:1.%7 -p`). The `TITLE` column shows app-set context — Claude sessions advertise their current task there, which is usually enough to identify a pane without capturing its content.

### Notifications

Windows marked `[bell]` or `[activity]` need attention (a process finished, errored, or produced output). Use `capture-pane` on the flagged window's panes to investigate.

To check for new notifications after skill load:

```bash
tmux list-windows -F '#{window_index} #{window_name} #{window_bell_flag} #{window_activity_flag}'
```

## Opening Panes

Use `split-window` with `-t $TMUX_PANE` so new panes open relative to Claude's pane. Always pass `-d` to avoid switching Claude's own pane to the new one.

### Layout Mapping

| User intent | Flags | Notes |
|---|---|---|
| right / beside | `-h -d` | Horizontal split |
| below / underneath | `-v -d` | Vertical split |
| right sidebar | `-h -d -l 40%` | Narrow right pane |
| left sidebar | `-h -d -b -l 40%` | Narrow left pane (`-b` = before) |
| bottom panel | `-v -d -l 25%` | Short pane below |
| top panel | `-v -d -b -l 25%` | Short pane above |

### Running a Command

```bash
tmux split-window -h -d -t $TMUX_PANE 'tail -f logs/dev.log'
```

The command string runs in the new pane's shell. When it exits, the pane closes. Use `$SHELL` or omit the command to open an interactive shell.

### Starting Claude Sessions

Pass the initial prompt as a CLI argument rather than using `send-keys`:

```bash
tmux split-window -h -d -t $TMUX_PANE 'claude "analyze the test failures"'
```

Use `send-keys` only for follow-up messages to an already-running session.

## Collaborative File Viewing

When collaborating on a file, open it in a sidebar pane so the user can see changes in real-time as you edit.

```bash
tmux split-window -h -d -l 40% -t $TMUX_PANE '<command> <file>'
```

#### Available Tools

!`bash ${CLAUDE_SKILL_DIR}/scripts/tools.sh`

#### Markdown Files

Prefer a terminal markdown renderer with file watching. Tools in preference order:

| Tool | Command | Notes |
|---|---|---|
| bun | `bun --watch file.md` | Rendered markdown with live reload |
| glow | `glow -w 0 file.md` | Rendered, no watch (reopen on change) |
| batwatch | `batwatch --watcher poll file.md` | Syntax-highlighted with file watching |
| bat | `bat --paging always file.md` | Syntax-highlighted source, no watch |
| less | `less file.md` | Plain text fallback |

#### Other Files

Open with `$EDITOR` when set, otherwise fall back to read-only viewers:

| Tool | Command | Notes |
|---|---|---|
| `$EDITOR` | `$EDITOR file.ts` | User's preferred editor, most auto-reload on external changes |
| batwatch | `batwatch --watcher poll file.ts` | Syntax-highlighted with file watching |
| bat | `bat --paging always file.ts` | Syntax-highlighted, read-only |
| less | `less file.ts` | Plain text fallback |

Use the first available option. If the pane exits immediately, the tool is missing, try the next.

## Capturing Pane Content

Use `capture-pane -p` to print to stdout instead of a paste buffer:

```bash
tmux capture-pane -t $TARGET -p
tmux capture-pane -t $TARGET -p -S -100
```

`-S -100` includes 100 lines of scrollback above the visible area.

## Gotchas

- Always use `-P -F '#{pane_id}'` to capture pane IDs at creation time
- Always use `-d` on `split-window` to avoid switching Claude's pane
- Use `$TMUX_PANE` (set by tmux natively and injected by context hook) to target the current pane
