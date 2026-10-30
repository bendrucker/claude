---
name: git:conflicts
description: Resolve git merge conflicts from a rebase, merge, or cherry-pick. Use also for a request to finish the operation and push, such as "fix conflicts and push".
argument-hint: "[--push]"
effort: high
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

Every conflicted file ends as the result both sides intended: each side's change preserved, the file coherent, and nothing dropped that the merged result does not account for. Resolve a conflict these rules do not cover to that standard. When the three versions do not reveal what each side intended, keep both sides and ask the user.

## Status

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/status.ts`

## Context

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/context.ts`

## Upstream

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/upstream.ts`

## Resolving

For each conflicted file, read base, ours, and theirs (`git show :1:path`, `:2:path`, `:3:path`), edit the file to the merged result, then `git add` it.

- Regenerate a generated file, such as a lockfile or a build artifact, from its source. Follow the project's `CLAUDE.md` for lockfile guidance.
- When repeated rebases hit the same conflict, [references/rerere.md](references/rerere.md) records a resolution and replays it.

Resolving is done when every conflicted file is staged and `git diff --cached --check` reports no conflict markers. Leave the commit, the continue, and the push to the user.

## Completing the Operation

Take the operation past the staged resolution only when the user asks for it: the `--push` argument, its alias `push`, or a request such as "fix conflicts and push". Then:

1. When no rebase, merge, or cherry-pick is in progress and upstream has diverged, run `git merge origin/<default-branch>` to produce the conflicts. A clean merge goes straight to the push.
2. Summarize the conflicts and confirm with `AskUserQuestion` before resolving 3 or more files, non-trivial code, or conflicts whose intent is ambiguous. Resolve without asking when the conflicts are generated files only, or fewer than 3 conflicts across 1-2 files with an obvious resolution.
3. Before continuing, set aside the dirty files unrelated to the resolution, which `git status --porcelain` lists. The continue then commits only the resolution. Run `git stash push -m "conflicts: <branch>" -- <files>` for all of them at once, then record that entry's SHA from `git stash list --format='%H %gs'`. When that stash fails, which the sandbox causes by blocking the unlink of a protected file such as `.mcp.json`, stash the files one at a time and skip the failures. Hide each file that cannot be stashed with `git update-index --assume-unchanged <file>`.
4. Continue the operation and run `git push`, then restore the files you set aside: `git update-index --no-assume-unchanged <file>` for each hidden file, and `git stash apply <sha>` then `git stash drop <sha>` for a stash you created. Restore by the SHA you recorded, because the stash stack is shared with every other worktree on the repo and the top entry may belong to another session.

The operation is done when git reports no operation in progress, the branch is pushed, and every file you set aside is back in the working tree.
