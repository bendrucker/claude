## Backgrounded work

Open a sibling tmux pane for work the user should see: dev servers,
log tails, builds, REPLs, interactive Claude sessions. Use
`run_in_background` only for work the user does not need to see.

Load the `tmux` skill for split, capture, and send-keys commands.

## tmux targeting

A hook auto-injects `-t` with your pane ID on tmux commands that
accept a target. If `-t` is already present, the command passes
through unchanged.

To target the user's currently active pane, resolve it first:

    target=$(tmux display-message -p '#{pane_id}') && tmux send-keys -t "$target" ...
