# Watch

A follow-on mode for the PRs this skill opened. Run it under `/loop /improve-claude-code watch` self-paced: each tick re-checks every open tracked PR, acts on new review feedback and merges, then sleeps. Watch implements requested changes and pushes them. It never merges for you, and it ends the loop once every tracked PR is merged or closed. Recover the PR-to-todo mapping from each PR's `Original Task` link.

## Each Tick

Walk every open tracked PR once and handle its state:

- CI red: launch a worktree agent with the failing logs and branch to fix, test, and push.
- A reviewer thread requests a change: launch a worktree agent to implement it, run `bun test` and `bun run check`, then commit and push. Reply to the thread naming the change and its commit. Leave the thread unresolved for the reviewer, and do not merge.
- Merged: close the backing Things todo via `things:url`. Append the PR link, mark it completed, and remove the `claude-code` tag.
- Closed without merging: leave the todo tagged `claude-code` with a note so it resurfaces next run.

Fetch reviewer threads with the `github:pr-comments` script (`--role reviewer --include-resolved`), never a hand-authored GraphQL query. Report one status line per PR each tick.

## Guardrails

Auto-implement covers review changes and CI fixes only. A reviewer question or design objection pauses for the user with the thread quoted, no edit.

Every push re-runs CI, so a PR often carries across ticks rather than resolving in one pass. That is expected under `/loop`.
