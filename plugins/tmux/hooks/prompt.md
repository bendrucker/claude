## Backgrounded work

Open a sibling tmux pane for work the user should see: dev servers,
log tails, builds, REPLs, interactive Claude sessions. Use
`run_in_background` only for work the user does not need to see.

Load the `tmux` skill for split, capture, and send-keys commands.

## tmux targeting

A hook tries to auto-inject `-t` with your pane ID on tmux commands
that accept a target. If `-t` is already present, the command passes
through unchanged. Injection is best-effort: it does NOT fire when the
command's argument contains shell metacharacters (`$(...)`, `;`,
`&&`, etc.), so pass `-t "$TMUX_PANE"` explicitly in those cases.

Default to your own pane and window. Reaching into another window is the
exception: the window-switching verbs (`select-window`, `switch-client`,
`next`/`previous`/`last-window`) prompt for permission, so cross-window work
should follow an explicit request. When it does, resolve the target first:

    target=$(tmux display-message -p '#{pane_id}') && tmux send-keys -t "$target" ...
