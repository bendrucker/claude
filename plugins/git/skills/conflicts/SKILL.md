---
name: conflicts
description: Resolving git merge conflicts. Use when rebasing, merging, or cherry-picking results in conflicts.
allowed-tools: [Read, Edit, Bash(git:*), Grep, Glob]
---

# Resolve Git Conflicts

Resolve merge conflicts during rebase, merge, or cherry-pick operations.

## Detection

Check for conflict state:

```bash
git status
```

Look for "Unmerged paths" or "both modified" indicators.

## Workflow

1. **List conflicted files**:
   ```bash
   git diff --name-only --diff-filter=U
   ```

2. **For each file**, read and identify conflict markers. See [references/markers.md](references/markers.md) for marker format.

3. **Resolve** by editing to remove markers and keep correct content.

4. **Stage** resolved files:
   ```bash
   git add <file>
   ```

5. **Continue** the interrupted operation:
   - Rebase: `git rebase --continue`
   - Merge: `git merge --continue`
   - Cherry-pick: `git cherry-pick --continue`

## Resolution Strategies

- **Ours**: Keep the current branch version (HEAD)
- **Theirs**: Keep the incoming version
- **Manual**: Combine both changes or write new code

For complex conflicts, understand the intent of both changes before resolving.
