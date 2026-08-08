# `launchd`

Launch agents for scheduled Claude Code runs. These are per-machine: install only on the always-on Mac Studio.

## `me.bendrucker.claude.discover.plist`

Runs `claude -p "/improve-claude-code discover --scheduled" --permission-mode acceptEdits` every Monday at 07:23 in the config repo. The scheduled Discover mode mines session history, writes the weekly digest, and auto-files high-confidence grounded candidates as `claude-code` Things todos. See the Scheduled section of `user/skills/improve-claude-code/SKILL.md`.

It runs through `/bin/zsh -lc` so the login shell resolves `claude` from PATH (Homebrew install location changes across versions).

## `me.bendrucker.claude.worktree-prune.plist`

Runs `worktree-prune.sh` nightly at 03:15. The script finds every repo under `~/src` (a real `.git` directory, one or two levels deep) and runs `wt step prune --min-age=1d -C <repo>`, which removes worktrees and branches already merged into each repo's default branch.

This exists because the sandbox's worktree deny-list scales with worktree count, and posix_spawn has a fixed argument-size limit: enough accumulated worktrees across repos overflow it (E2BIG), which kills every Bash and Skill spawn for the rest of a session. This has already happened once (155 errors across 13 sessions). The recurrence signal is `tool_errors ILIKE '%E2BIG%'` in the session index (see `claude-code:session`).

`wt step prune` only removes worktrees that are merged/content-integrated into the default branch. It skips dirty worktrees (uncommitted changes) unless `--force` is passed, which never happens here. It also skips locked worktrees, the main worktree, and anything younger than `--min-age` (1 day, guarding freshly created worktrees that happen to sit on the same commit as main). It does not check for a live process or shell still `cd`'d into a worktree that is otherwise clean and merged. `wt remove --reap` can kill processes in a worktree being removed, but that's opt-in on `wt remove`, not automatic on `wt step prune`. It only handles processes, not the general case of an idle interactive session sitting in a now-removed directory. 03:15 is chosen to minimize the odds of that overlap. The underlying gap is worth raising with Worktrunk as a feature request (a refusal, not just `--reap`, when a live process's cwd is under the candidate worktree).

### Removal Criterion

If worktree count across `~/src` stays under 15 unaided for a month (i.e. this job isn't needed to stay under the ~30 ceiling), drop it.

## Install

Copy the plist into `~/Library/LaunchAgents`, including in dotfiles setup. Symlinks break persistence: launchd on macOS 14+ ignores symlinked plists at login, so a symlinked agent loads once via `launchctl` and then never reloads after a reboot.

```sh
cp ~/.claude/launchd/<plist> ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/<plist>
```

After editing a source plist, re-copy and reload:

```sh
launchctl bootout gui/$UID/<label>
cp ~/.claude/launchd/<plist> ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/<plist>
```

Where `<plist>` is the filename (e.g. `me.bendrucker.claude.discover.plist`) and `<label>` is its `Label` value without the extension (e.g. `me.bendrucker.claude.discover`).

## Verify

```sh
launchctl list | grep bendrucker
tail -f ~/Library/Logs/claude-discover.log ~/Library/Logs/claude-discover.err.log
tail -f ~/Library/Logs/claude-worktree-prune.log ~/Library/Logs/claude-worktree-prune.err.log
```

Trigger a run immediately without waiting for the schedule:

```sh
launchctl kickstart gui/$UID/me.bendrucker.claude.discover
launchctl kickstart gui/$UID/me.bendrucker.claude.worktree-prune
```
