---
name: git:conflicts
description: Resolving git merge conflicts. Use when rebasing, merging, or cherry-picking results in conflicts.
allowed-tools:
  - Read
  - Edit
  - Grep
  - Glob
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
  - Bash(bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/*:*)
hooks:
  PreToolUse:
    - matcher: "Bash(git commit:*)|Bash(git rebase --continue:*)|Bash(git merge --continue:*)|Bash(git cherry-pick --continue:*)"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/check-markers.ts"
---

# Git Conflicts

## Status

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/status.ts 2>/dev/null`

## Context

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/context.ts 2>/dev/null`

## Upstream

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/conflicts/scripts/upstream.ts 2>/dev/null`

## Three-Way Access

Git stores three versions in staging slots during conflicts:

| Slot | Version | Command |
|------|---------|---------|
| `:1:path` | Base (common ancestor) | `git show :1:path` |
| `:2:path` | Ours (HEAD) | `git show :2:path` |
| `:3:path` | Theirs (incoming) | `git show :3:path` |

## References

- [rerere.md](references/rerere.md) — Automatic resolution reuse for repeated rebases
