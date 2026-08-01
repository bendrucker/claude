.result.snapshot as $s
| ($s.panes // []) as $panes
| "herdr \($s.version // "?")  protocol \($s.protocol // "?")   this pane: \(env.HERDR_PANE_ID // "unknown")",
  "",
  ( ($s.workspaces // [])[]
    | . as $w
    | "\($w.workspace_id)  \($w.label // "")\(if $w.focused then "  *focused*" else "" end)"
      + ( if $w.worktree
          then "  [\($w.worktree.repo_name)\(if $w.worktree.is_linked_worktree then " worktree" else "" end)] \($w.worktree.checkout_path)"
          else "" end )
    , ( $panes[]
        | select(.workspace_id == $w.workspace_id)
        | "    \(.pane_id)  \(.agent // "shell")  \(.agent_status // "?")"
          + (if .agent_session.value then "  session \(.agent_session.value)" else "" end)
          + "\n      cwd \(.foreground_cwd // .cwd // "?")"
          + (if (.terminal_title_stripped // "") != "" then "\n      title \(.terminal_title_stripped)" else "" end)
      )
  )
