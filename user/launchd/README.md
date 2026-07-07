# `launchd`

Launch agents for scheduled Claude Code runs. These are per-machine: install only on the always-on Mac Studio.

## `me.bendrucker.claude.discover.plist`

Runs `claude -p "/improve-claude-code discover --scheduled" --permission-mode acceptEdits` every Monday at 07:23 in the config repo. The scheduled Discover mode mines session history, writes the weekly digest, and auto-files high-confidence grounded candidates as `claude-code` Things todos. See the Scheduled section of `user/skills/improve-claude-code/SKILL.md`.

It runs through `/bin/zsh -lc` so the login shell resolves `claude` from PATH (Homebrew install location changes across versions).

## Install

Copy the plist into `~/Library/LaunchAgents`, including in dotfiles setup. Symlinks break persistence: launchd on macOS 14+ ignores symlinked plists at login, so a symlinked agent loads once via `launchctl` and then never reloads after a reboot.

```sh
cp ~/.claude/launchd/me.bendrucker.claude.discover.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/me.bendrucker.claude.discover.plist
```

After editing the source plist, re-copy and reload:

```sh
launchctl bootout gui/$UID/me.bendrucker.claude.discover
cp ~/.claude/launchd/me.bendrucker.claude.discover.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/me.bendrucker.claude.discover.plist
```

## Verify

```sh
launchctl list | grep bendrucker
tail -f ~/Library/Logs/claude-discover.log ~/Library/Logs/claude-discover.err.log
```

Trigger a run immediately without waiting for Monday:

```sh
launchctl kickstart gui/$UID/me.bendrucker.claude.discover
```
