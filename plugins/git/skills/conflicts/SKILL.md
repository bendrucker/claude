---
name: git:conflicts
description: Resolve git merge conflicts from a rebase, merge, or cherry-pick. Use also for a request to finish the operation and push, such as "fix conflicts and push".
argument-hint: "[--push]"
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

Every conflicted file ends as the result both sides intended: each side's change preserved, the file coherent, and nothing dropped that the merged result does not account for. Resolve a conflict these rules do not cover to that standard, and ask the user when the three versions do not reveal what each side intended.

## Status

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/status.ts`

## Context

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/context.ts`

## Upstream

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/upstream.ts`

## Resolving

Git stores three versions of a conflicted file in staging slots:

| Slot | Version | Command |
|------|---------|---------|
| `:1:path` | Base (common ancestor) | `git show :1:path` |
| `:2:path` | Ours (HEAD) | `git show :2:path` |
| `:3:path` | Theirs (incoming) | `git show :3:path` |

For each conflicted file, read all three slots, edit the file to the merged result, then `git add` it.

- Regenerate a generated file, such as a lockfile or a build artifact, from its source instead of merging it by hand. Follow the project's `CLAUDE.md` for lockfile guidance.
- When the correct result is unclear, keep both sides and ask the user which to keep.
- When the file's purpose is unclear, ask the user before resolving it.
- When repeated rebases hit the same conflict, [references/rerere.md](references/rerere.md) records a resolution and replays it.

Resolving is done when every conflicted file is staged and `git diff --cached --check` reports no conflict markers. Leave the commit, the continue, and the push to the user.

## Completing the Operation

Take the operation past the staged resolution only when the user asks for it: the `--push` argument, its alias `push`, or a request such as "fix conflicts and push". Then:

1. When no rebase, merge, or cherry-pick is in progress and upstream has diverged, run `git merge origin/<default-branch>` to surface the conflicts. A clean merge goes straight to the push.
2. Summarize the conflicts and confirm with `AskUserQuestion` before resolving 3 or more files, non-trivial code, or conflicts whose intent is ambiguous. Resolve without asking when the conflicts are generated files only, or fewer than 3 conflicts across 1-2 files with an obvious resolution.
3. Resolve every conflicted file.
4. Set aside the dirty files unrelated to the resolution, so the continue commits only the resolution. `git status --porcelain` lists them. Run `git stash push -m "conflicts: <branch>" -- <files>` for all of them at once, then record that entry's SHA from `git stash list --format='%H %gs'`. When that stash fails, which the sandbox causes by blocking the unlink of a protected file such as `.mcp.json`, stash the files one at a time and skip the failures. Hide each file that cannot be stashed with `git update-index --assume-unchanged <file>`.
5. Continue with `git rebase --continue`, `git merge --continue`, or `git cherry-pick --continue`.
6. Run `git push`, then restore the files you set aside: `git update-index --no-assume-unchanged <file>` for each hidden file, and `git stash apply <sha>` then `git stash drop <sha>` for a stash you created. Restore by the SHA you recorded, because the stash stack is shared with every other worktree on the repo and the top entry may belong to another session.

The operation is done when git reports no operation in progress, the branch is pushed, and every file you set aside is back in the working tree.
