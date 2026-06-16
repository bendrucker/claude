---
name: git:conflicts
description: Resolving git merge conflicts during rebase, merge, or cherry-pick. Use when conflicts arise. Can also drive the operation to completion and push when asked (e.g. "fix conflicts and push").
allowed-tools:
  - Read
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - Bash(git status:*)
  - Bash(git diff:*)
  - Bash(git show :*:*)
  - Bash(git add:*)
  - Bash(git log:*)
  - Bash(git rebase:*)
  - Bash(git merge:*)
  - Bash(git cherry-pick:*)
  - Bash(git rerere:*)
  - Bash(git stash:*)
  - Bash(git update-index:*)
  - Bash(git fetch:*)
  - Bash(git push:*)
  - Bash(bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/*)
hooks:
  PreToolUse:
    - matcher: "Bash(git commit:*)|Bash(git rebase --continue:*)|Bash(git merge --continue:*)|Bash(git cherry-pick --continue:*)"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/check-markers.ts"
---

# Git Conflicts

## Status

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/status.ts`

## Context

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/context.ts`

## Upstream

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/upstream.ts`

## Three-Way Access

Git stores three versions in staging slots during a conflict:

| Slot | Version | Command |
|------|---------|---------|
| `:1:path` | Base (common ancestor) | `git show :1:path` |
| `:2:path` | Ours (HEAD) | `git show :2:path` |
| `:3:path` | Theirs (incoming) | `git show :3:path` |

## Resolving

For each conflicted file:

- Read the three slots above to understand base, ours, and theirs.
- Edit the file to produce the correct merged result, then `git add` it.
- For generated files (lockfiles, build artifacts), delete and regenerate rather than merge by hand. Follow the project's `CLAUDE.md` for lockfile-specific guidance.
- Never silently drop either side. When in doubt, keep both and ask.
- If a conflict is in a file you don't understand, ask rather than guess.

## Committing and Pushing

This step runs only when you are asked to take the operation to completion (e.g. the user ran `/git:conflicts push` or said "fix conflicts and push"). On auto-activation, or when asked only to resolve, stop after `git add` and do not commit, continue, or push.

When driving to completion:

1. **Initiate the merge if needed.** If no rebase, merge, or cherry-pick is in progress but upstream has diverged, run `git merge origin/<default-branch>` to surface conflicts. If it merges cleanly, push and finish.
2. **Assess complexity before resolving.**
   - **Simple** (generated files only, or fewer than 3 conflicts across 1-2 files with obvious resolutions): proceed.
   - **Complex** (3+ files, non-trivial code, or ambiguous intent): summarize the conflicts and confirm with the user via `AskUserQuestion` before resolving.
3. **Resolve** per the section above.
4. **Stash unrelated dirty files.** Check `git status --porcelain` for unstaged changes beyond the resolved conflicts. Try `git stash push -m "conflicts: temp" -- <files>` for all of them at once. If the stash fails (the sandbox may block unlinking protected files like `.mcp.json`), stash individually and skip failures. For files that cannot be stashed, hide them with `git update-index --assume-unchanged <file>`.
5. **Continue the operation** with `git rebase --continue`, `git merge --continue`, or `git cherry-pick --continue`.
6. **Push and restore.** Run `git push`, then restore hidden files with `git update-index --no-assume-unchanged <file>` and `git stash pop` if anything was stashed.

## References

- [rerere.md](references/rerere.md) — Automatic resolution reuse for repeated rebases
