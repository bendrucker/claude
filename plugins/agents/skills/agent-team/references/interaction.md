# Display Modes and Interaction

## Display Modes

Set `teammateMode` in settings or pass `--teammate-mode`:

| Mode | Behavior |
|---|---|
| `auto` (default) | Split panes inside tmux, in-process otherwise |
| `in-process` | All teammates in main terminal |
| `tmux` | Each teammate in its own pane. Auto-detects tmux vs iTerm2. |

Split panes require tmux or iTerm2 with the `it2` CLI.

## Keyboard Shortcuts

**In-process mode**:

| Key | Action |
|---|---|
| Shift+Up/Down | Select a teammate |
| Enter | View teammate's session |
| Escape | Interrupt teammate's current turn |
| Ctrl+T | Toggle task list |
| Shift+Tab | Cycle to delegate mode |

**Split-pane mode**: click into a teammate's pane to interact directly.
