.result.snapshot as $s
| ($s.panes // []) as $panes
| "herdr \($s.version // "?")  protocol \($s.protocol // "?")   this pane: \(env.HERDR_PANE_ID // "unknown")",
  "",
  ( ($s.workspaces // [])[]
    | . as $w
    | ($w.worktree.checkout_path // "") as $root
    | "\($w.workspace_id)  \($w.label // "")\(if $w.focused then "  *focused*" else "" end)"
      + ( if $w.worktree
          then "  [\($w.worktree.repo_name)\(if $w.worktree.is_linked_worktree then " worktree" else "" end)] \($root)"
          else "" end )
    , ( $panes[]
        | select(.workspace_id == $w.workspace_id)
        | (.foreground_cwd // .cwd // "") as $cwd
        | "    \(.pane_id)  \(.agent // "shell")/\(.agent_status // "?")"
          + (if .agent_session.value then "  \(.agent_session.value)" else "" end)
          + (if $cwd != "" and $cwd != $root then "  \($cwd)" else "" end)
          + ( ((.terminal_title_stripped // "") | sub(" · [0-9a-f-]+$"; "")) as $title
              | if .agent and $title != "" then "  \"\($title)\"" else "" end )
      )
  )
