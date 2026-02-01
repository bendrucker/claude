---
name: conflicts
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
  - Bash(bun ${CLAUDE_SKILL_ROOT}/scripts/*:*)
hooks:
  PreToolUse:
    - matcher: "Bash(git commit:*)|Bash(git rebase --continue:*)|Bash(git merge --continue:*)|Bash(git cherry-pick --continue:*)"
      hooks:
        - type: command
          command: "bun ${CLAUDE_SKILL_ROOT}/scripts/check-markers.ts"
---

# Git Conflicts

## Status

!`bun ${CLAUDE_SKILL_ROOT}/scripts/status.ts 2>/dev/null || echo "Run status.ts manually"`

## Context

!`bun ${CLAUDE_SKILL_ROOT}/scripts/context.ts 2>/dev/null || echo "Run context.ts manually"`

## Three-Way Access

Git stores three versions in staging slots during conflicts:

| Slot | Version | Command |
|------|---------|---------|
| `:1:path` | Base (common ancestor) | `git show :1:path` |
| `:2:path` | Ours (HEAD) | `git show :2:path` |
| `:3:path` | Theirs (incoming) | `git show :3:path` |

## References

- [rerere.md](references/rerere.md) — Automatic resolution reuse for repeated rebases
