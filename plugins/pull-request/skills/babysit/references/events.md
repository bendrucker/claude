# Other Events

Handlers for watcher events other than `running`, `failing`, and `success`, which [SKILL.md](../SKILL.md#event-handlers) covers.

#### conflicts

Find the conflicting files with a dry-run merge:

```
git fetch origin <base>
git merge origin/<base> --no-commit --no-ff
git diff --name-only --diff-filter=U
git merge --abort
```

Resolve by merging `origin/<base>` in and pushing a merge commit. A merge commit keeps the head's reviews and every checkout of the branch valid. Delegate the conflicted files to `git:conflicts`, and stash only by the SHA it records, since the stash stack is shared across worktrees.

- Lockfiles and generated files (`bun.lock`, etc.): regenerate per project convention (e.g. `rm bun.lock && bun install`).
- Additive keyed maps, where parallel PRs each add entries to one object: keep both sides' keys. In this marketplace those are `pluginConfigs` in `user/settings.json` and `userConfig` in a plugin's `plugin.json`.
- Mechanically clear source conflicts: resolve.
- A key both sides changed to different values, or any ambiguous or semantic conflict: report the hunks and `TaskStop`, since this runs unattended.

Commit and push. In Merge Mode, re-arm per [`merge-mode.md`](../merge-mode.md#re-arm) and count it as a submit attempt.

#### mergeable-unknown

The platform has already re-polled and could not decide. Run the dry-run from [conflicts](#conflicts). Route conflicting paths through that handler. When the merge is clean, report the PR as mergeable and keep watching.

#### queued-timeout

Report the event with `minutes` and keep watching.

#### api-error

Report the event with `consecutive`. On a second threshold event, `TaskStop`.

#### rate-limited

Report `retry_after` and keep watching.

#### pr-closed

The PR closed without merging, or its source branch is gone. Report and stop. The watcher has exited.

#### merged

In Merge Mode this is the success terminal. Report the merge and the commits since the start SHA, then stop. The watcher has exited.

#### max-time-reached

Report the event with `minutes` and the commits since the start SHA, then stop without re-arming. The watcher has exited.
