---
name: tmux
description: Tmux session awareness and pane interaction. Use when the user asks about tmux panes, wants to capture terminal output, send keys to another pane, open a process in a pane, or organize panes in their window.
allowed-tools: [Bash(tmux:*)]
hooks:
  PreToolUse:
    - matcher: "Bash(tmux:*)"
      hooks:
        - type: command
          command: |
            cat | jq '
              if (.tool_input.command | test("^tmux\\s+(display-message|display|list-sessions|ls|list-windows|lsw|list-panes|lsp|capture-pane|capturep|show-options|show|has-session|has)\\b"))
              then {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: {dangerouslyDisableSandbox: true}}}
              else {hookSpecificOutput: {hookEventName: "PreToolUse", updatedInput: {dangerouslyDisableSandbox: true}}}
              end'
---

# tmux

The SessionStart hook injects `TMUX_SESSION_NAME`, `TMUX_WINDOW_INDEX`, `TMUX_WINDOW_NAME`, `TMUX_PANE_INDEX`, and `TMUX_PANE_ID` into the environment. Use `$TMUX_PANE_ID` to identify the current pane and target adjacent ones.

## Opening Panes

Use `split-window` with `-t $TMUX_PANE_ID` so new panes open relative to Claude's pane. Always pass `-d` to avoid switching Claude's own pane to the new one.

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
tmux split-window -h -d -t $TMUX_PANE_ID 'tail -f logs/dev.log'
```

The command string runs in the new pane's shell. When it exits, the pane closes. Use `$SHELL` or omit the command to open an interactive shell.

## Capturing Pane Content

Use `capture-pane -p` to print to stdout instead of a paste buffer:

```bash
tmux capture-pane -t $TARGET -p
tmux capture-pane -t $TARGET -p -S -100
```

`-S -100` includes 100 lines of scrollback above the visible area.

## Agent Handoffs

Launch a `claude` CLI instance in a new tmux window or session to hand off work.

### new-window

Spawns a window in the current session. Visible in the status bar tab list.

```bash
tmux new-window -d -n task-name -t "$TMUX_SESSION_NAME" 'claude -p "prompt here"'
```

- `-d` keeps focus on the current window
- `-n task-name` labels the window in the status bar
- `-t "$TMUX_SESSION_NAME"` targets the current session

This is the common case — the agent runs alongside the user's current work and is easy to switch to.

### new-session

Spawns a detached session. Use for isolated or long-lived tasks.

```bash
tmux new-session -d -s task-name 'claude -p "prompt here"'
```

- `-d` creates the session without attaching
- `-s task-name` names the session for `tmux attach -t task-name`
