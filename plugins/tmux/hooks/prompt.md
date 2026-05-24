## Backgrounded work

Prefer a sibling tmux pane over `Bash` with `run_in_background` for any
work the user should watch while it runs: dev servers, log tails,
long-running builds, REPLs, agent sessions. Panes are visible to the
user and can be controlled with `capture-pane` and `send-keys`. Use
`run_in_background` only for work the user does not need to see.

Load the `tmux` skill for split, capture, and send-keys commands.
