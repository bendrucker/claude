# Desktop App

Claude Code in the Claude desktop app sets `CLAUDE_CODE_ENTRYPOINT` to `claude-desktop` (`claude-desktop-3p` on third-party providers). Hooks, mods, and skills that branch on it need testing under both values and under the terminal's `cli`.

## Entrypoint Override

Claude Code keeps a `CLAUDE_CODE_ENTRYPOINT` already in its environment and only derives one (`cli`, `sdk-cli`, `mcp`) when it is unset. Hook commands inherit the value, so a terminal session can take the desktop branch of a hook or skill:

```bash
./dev.sh --desktop                              # claude-desktop
./dev.sh --desktop=claude-desktop-3p
CLAUDE_CODE_ENTRYPOINT=claude-desktop claude --plugin-dir ./plugins/<name> --setting-sources local
```

The override reaches the same code paths as the app for anything that reads the variable, and headless `-p` runs keep it too, so a hook E2E test can set it in the child's environment. It does not give the terminal the app's UI. Notifications still route through the terminal, and anything the app renders itself (permission cards, diff views, the browser pane) is absent. Those need the checklist below.

Cloud sessions driven from the desktop app report `remote_desktop`, which Claude Code also groups as a desktop surface. A branch that should cover them has to match that value as well.

## Manual Checklist

Run these in the desktop app after changing a desktop branch, with the plugin or settings change installed:

- Invoke `review:human` on a pull request and confirm the desktop path renders where the skill sends it, and the terminal path still works from `./dev.sh`.
- Create a worktree from a session (`git worktree add`, the `EnterWorktree` tool) and confirm `user/hooks/enter-worktree` and `user/hooks/worktree` produce the desktop behavior, then remove it and confirm the `WorktreeRemove` hook still passes.
- Trigger a permission prompt and an idle wait, and confirm the `Notification` hooks in `user/settings.json` neither duplicate the app's own notification nor stay silent.
- Enter plan mode with the `plan` plugin, write a plan, and exit. Confirm the guidelines inject once, the gate fires on an oversized plan, and the mod's status line output appears or degrades cleanly.
- After the session ends, confirm the observability session index records it with the desktop entrypoint and that its `mods` query shows the session's `mod_events`.
