---
name: tmux
description: Tmux session, window, and pane management. Use when capturing output, sending keys, opening processes in panes, or checking notifications.
argument-hint: "[capture | send | split | notify | list] [target ...]"
effort: low
allowed-tools:
  - "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/pane.sh:*)"
  - "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/window.sh:*)"
  - "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/session.sh:*)"
  - "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/sessions.sh)"
hooks:
  PreToolUse:
    - matcher: "Bash(tmux:*)"
      hooks:
        - type: command
          command: "bash ${CLAUDE_PLUGIN_ROOT}/skills/tmux/scripts/safe-command.sh"
    - matcher: "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/:*)"
      hooks:
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow"}}'
---

# tmux

## Arguments

`$0` (optional verb) routes to a section; pass the target pane, window, or session as the rest. With no verb, infer the operation from the request.

- `capture`: print pane content. See [Capturing Pane Content](#capturing-pane-content).
- `send`: send keys to a running pane. See [Starting Claude Sessions](#starting-claude-sessions).
- `split`: open a pane. See [Opening Panes](#opening-panes).
- `notify`: check which windows need attention (`bell`/`activity`). See [Session](#session).
- `list`: inventory panes, windows, and sessions. See [Drilling Into Other Targets](#drilling-into-other-targets).

## Pane

!`bash ${CLAUDE_SKILL_DIR}/scripts/pane.sh`

Use `$TMUX_PANE` to identify the current pane and target adjacent ones.

## Window

!`bash ${CLAUDE_SKILL_DIR}/scripts/window.sh`

Each pane line ends with its geometry as `@<left>,<top> <width>x<height>`, in cell coordinates from the window's top-left. Resolve spatial references from these: LHS = lowest `left`, RHS = highest `left`, top = lowest `top`, bottom = highest `top`. When describing layouts, draw ASCII box diagrams from the positions and sizes.

### Worktrees and Parallel Panes

Panes in a git repo show their branch and whether the checkout is a linked `(worktree)` or the primary `(main)` one. When the user refers to work by branch or worktree ("the pane on the X branch", "the worktree for Y", "the other pane, which is ready"), match the reference to a pane's branch and dispatch to it with `send-keys` (or treat it as already running) rather than entering a worktree of your own. A pane already in a worktree is set up for parallel work; hand off to it instead of duplicating the checkout.

## Session

!`bash ${CLAUDE_SKILL_DIR}/scripts/session.sh`

The `TITLE` column shows the active pane's title in each window. Claude sessions advertise their current task there, usually enough to identify a window without capturing its content. Windows marked `here` are the current window; `bell` or `activity` flags mean the window needs attention (a process finished, errored, or produced output).

## Sessions

!`bash ${CLAUDE_SKILL_DIR}/scripts/sessions.sh`

### Drilling Into Other Targets

Each script accepts an optional target argument to inspect any pane, window, or session — not just the current one:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/session.sh other-session
bash ${CLAUDE_SKILL_DIR}/scripts/window.sh other-session:2
bash ${CLAUDE_SKILL_DIR}/scripts/pane.sh %12
```

Compose them to drill down: pick a session from `sessions.sh`, list its windows with `session.sh <name>`, then inspect a specific window with `window.sh <name>:<idx>`.

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

Inline a command string only for a single bare command:

```bash
tmux split-window -h -d -t $TMUX_PANE 'tail -f logs/dev.log'
```

The command runs in the new pane's shell. When it exits, the pane closes. Use `$SHELL` or omit the command to open an interactive shell.

Anything past a bare command can make `split-window` silently fail: a `;`, quotes, an `exec` fallback, or other shell metacharacters. The failure is quiet: no pane opens, no error prints, and `-P -F '#{pane_id}'` returns nothing. It reads as the pane never appearing, not as the pane opening then disappearing. Split bare and `send-keys` the command instead. The new pane's shell runs the keys verbatim, past tmux's own parsing of the inline string:

```bash
pane=$(tmux split-window -h -d -t $TMUX_PANE -P -F '#{pane_id}')
tmux send-keys -t "$pane" 'cd repo; exec zsh' Enter
```

### Starting Claude Sessions

Pass the initial prompt as a CLI argument rather than using `send-keys`:

```bash
tmux split-window -h -d -t $TMUX_PANE 'claude "analyze the test failures"'
```

A prompt with a `;`, nested quotes, or other metacharacters hits the same silent inline-parsing failure. Split bare and `send-keys` the whole `claude '...'` line instead (see [Running a Command](#running-a-command)). Use `send-keys` only for follow-up messages to an already-running session.

## Collaborative File Viewing

When collaborating on a file, open it in a sidebar pane so the user sees changes in real-time as you edit.

```bash
tmux split-window -h -d -l 40% -t $TMUX_PANE '<command> <file>'
```

The inline form is safe only when both the command and the path are bare. A filename with a space, or a `$EDITOR` carrying flags (`code -w`), hits the same silent no-op. Split bare and `send-keys` the viewer line instead (see [Running a Command](#running-a-command)).

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

Use the first available option. If the pane exits immediately, the tool is missing; try the next.

## Capturing Pane Content

Use `capture-pane -p` to print to stdout instead of a paste buffer.

```bash
tmux capture-pane -t $TARGET -p
tmux capture-pane -t $TARGET -p -S -100
```

`-S -100` includes 100 lines of scrollback above the visible area.

## Gotchas

- Always use `-P -F '#{pane_id}'` to capture pane IDs at creation time
- Always use `-d` on `split-window` to avoid switching Claude's pane
- `split-window` with an inline command containing `;`, quotes, or metacharacters can silently no-op (no pane, no error). Split bare, then `send-keys` the command
- Use `$TMUX_PANE` (set by tmux natively and injected by context hook) to target the current pane
