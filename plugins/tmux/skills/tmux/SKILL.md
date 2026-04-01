---
name: tmux
description: Tmux session awareness and pane interaction. Use when the user asks about tmux panes, wants to capture terminal output, send keys to another pane, open a process in a pane, or organize panes in their window.
allowed-tools:
  - Bash(tmux:*)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/pane.ts:*)"
hooks:
  PreToolUse:
    - matcher: "Bash(tmux:*)"
      hooks:
        - type: command
          command: |
            cat | jq '
              if (.tool_input.command | test("^tmux\\s+(display-message|display|list-sessions|ls|list-windows|lsw|list-panes|lsp|capture-pane|capturep|show-options|show|has-session|has)\\b"))
              then {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}
              else {hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}
              end'
    - matcher: "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
      hooks:
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: (.tool_input + {dangerouslyDisableSandbox: true})}}'
---

# tmux

## Current Pane

!`tmux display-message -p '- Session: #{session_name}
- Window: #{window_index} (#{window_name})
- Pane: #{pane_index} (#{pane_id})' 2>/dev/null || echo 'not running in tmux'`

Use `$TMUX_PANE` to identify the current pane and target adjacent ones.

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

## Collaborative File Viewing

When collaborating on a file, open it in a sidebar pane so the user can see changes in real-time as you edit.

```bash
tmux split-window -h -d -l 40% -t $TMUX_PANE '<command> <file>'
```

#### Available Tools

- markless: !`which markless 2>/dev/null || echo 'not found'`
- batwatch: !`which batwatch 2>/dev/null || echo 'not found'`
- bat: !`which bat 2>/dev/null || echo 'not found'`
- EDITOR: !`echo "${EDITOR:-unset}"`

#### Markdown Files

Prefer a terminal markdown renderer with file watching. Tools in preference order:

| Tool | Command | Notes |
|---|---|---|
| markless | `markless --watch file.md` | Rendered markdown with live reload |
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

## Pane Tracking

Track named panes via tmux user options so they persist across tool calls:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/pane.ts register logs --id %5
bun ${CLAUDE_SKILL_DIR}/scripts/pane.ts get logs
bun ${CLAUDE_SKILL_DIR}/scripts/pane.ts list
bun ${CLAUDE_SKILL_DIR}/scripts/pane.ts dismiss logs
bun ${CLAUDE_SKILL_DIR}/scripts/pane.ts dismiss-all
```

`register` stores the pane under a name. `get` returns JSON with live status. `list` shows a table (or `--json`). `dismiss` kills the pane and removes tracking.

## Gotchas

- Always use `-P -F '#{pane_id}'` to capture pane IDs at creation time
- Always use `-d` on `split-window` to avoid switching Claude's pane
- Use `$TMUX_PANE` (set by tmux natively and injected by context hook) to target the current pane
- Tracked pane names: alphanumeric and hyphens only
