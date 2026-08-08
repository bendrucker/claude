# Other Events

Load this when the watcher emits an event other than `running`, `failing`, or `success`. [SKILL.md](../SKILL.md#event-handlers) covers those three.

#### conflicts

Reproduce the conflict locally to identify the conflicting files:

```
git merge origin/<base> --no-commit --no-ff
git diff --name-only --diff-filter=U
git merge --abort
```

Lockfiles or generated files (`bun.lock`, etc.): regenerate per project convention (e.g. `rm bun.lock && bun install`), commit, push.

Real source conflicts: rebase on `origin/<base>` and delegate to the `git:conflicts` skill. Resolve, commit, and push where mechanically clear. Where ambiguous or semantic, report the conflicting hunks and call `TaskStop` (this runs unattended, so never guess a merge).

In Merge Mode, after any push here, re-arm per [Merge Mode](../SKILL.md#merge-mode) and count it as a submit attempt.

#### mergeable-unknown

The platform could not determine mergeability after its own bounded re-polling, so run the authoritative local check: `git fetch origin <base>`, then the same dry-run as [conflicts](#conflicts). Conflicting paths route through that handler. If the merge is clean, report that the PR is mergeable and keep watching.

#### queued-timeout

Report the event (include `minutes`) and wait. The watcher continues polling.

#### api-error

Report the event (include `consecutive`). If consecutive errors continue past a second threshold event, call `TaskStop`.

#### rate-limited

Report `retry_after` and wait. The watcher resumes polling once the window elapses.

#### pr-closed

The PR closed without merging, or its source branch no longer exists. Report and stop. The watcher has already exited.

#### merged

The PR landed. In [Merge Mode](../SKILL.md#merge-mode) this is the success terminal: report the merge and the work done since the start SHA, then stop. The watcher has already exited.

#### max-time-reached

Report the event (include `minutes`) and the work done since the start SHA, then stop. The watcher has already exited; do not re-arm (see [Bounds](../SKILL.md#bounds)).
