# Troubleshooting

Common issues and solutions when using git-town.

## Conflict Resolution

### During Sync

When `git town sync` encounters conflicts:

```
CONFLICT (content): Merge conflict in src/file.ts
```

**Resolution:**

1. Open conflicting files and resolve conflicts
2. Stage resolved files: `git add src/file.ts`
3. Continue: `git town continue`

### During Rebase

If a specific commit can't be applied cleanly:

**Option 1: Resolve and continue**
```bash
# Fix conflicts
git add <files>
git town continue
```

**Option 2: Skip the commit**
```bash
git town skip
```

Use skip when the commit is no longer relevant (e.g., changes were made differently upstream).

**Option 3: Abort entirely**
```bash
git town abort
```

Restores the state before the operation started.

## Undo Operations

### Undo Last Command

```bash
git town undo
```

Works for any git-town command. Reverses all changes made by that command.

### Undo Limitations

`undo` can reverse:
- Branch creation/deletion
- Commits made by git-town
- Config changes

`undo` cannot reverse:
- Manual git commands run between git-town commands
- Changes pushed to remote (undoes local only)
- Operations by other tools

### Multiple Undos

Each `git town undo` reverses one command. For multiple operations:

```bash
git town undo  # Undo last
git town undo  # Undo second-to-last
```

## Common Errors

### "Branch has uncommitted changes"

git-town requires a clean working directory.

**Solution:**
```bash
git stash
git town <command>
git stash pop
```

### "Cannot sync contribution branch"

Contribution branches don't push automatically.

**Solution:** This is expected. Use `git push` manually if needed.

### "Branch has no parent"

The branch wasn't created with git-town.

**Solution:**
```bash
git town set-parent main  # Or appropriate parent
```

### "Rebase conflict: could not apply commit"

A commit conflicts with upstream changes.

**Solutions:**
1. Resolve conflicts and `git town continue`
2. Use `git town skip` if the commit is obsolete
3. Use `git town abort` to cancel

### "Push rejected: non-fast-forward"

Someone else pushed to your branch.

**Solution:**
```bash
git town sync  # Pulls changes and rebases
```

### "Cannot determine hosting platform"

git-town can't detect GitHub/GitLab/etc.

**Solution:**
```bash
git town config hosting-platform github  # Or gitlab, bitbucket, etc.
```

## Stack Issues

### Reordering Stack Branches

If branches are in the wrong order:

```bash
git town swap          # Swap with parent
git town set-parent    # Choose new parent
```

### Detaching from Stack

To make a branch independent:

```bash
git town detach
```

Now the branch is a direct child of main.

### Missing Parent After Clone

When cloning a repo with git-town metadata, parents should persist. If not:

```bash
git town set-parent <parent-branch>
```

## Sync Behavior Issues

### Sync Not Pushing

Check if branch is marked as prototype or contribution:

```bash
git town branch
```

Remove the special status:
```bash
git town prototype   # Toggle off
git town contribute  # Toggle off
```

### Sync Skipping Branch

Branch might be parked:

```bash
git town unpark
git town sync
```

### Sync Using Wrong Strategy

Check and change sync strategy:

```bash
git town config sync-feature-strategy
git town config sync-feature-strategy rebase  # Or merge
```

## Platform Integration Issues

### "Could not create pull request"

**GitHub:** Ensure `gh` is authenticated:
```bash
gh auth status
gh auth login
```

**GitLab:** Ensure `glab` is authenticated:
```bash
glab auth status
glab auth login
```

### Wrong PR Target Branch

git-town targets the parent branch. If wrong:

```bash
git town set-parent correct-parent
git town propose
```

## Recovery Procedures

### Stuck in Rebase State

If git is in a broken rebase state:

```bash
git town abort        # Try git-town abort first
git rebase --abort    # Fallback to git directly
```

### Lost Branch

If a branch was accidentally deleted:

```bash
git reflog                          # Find the commit
git branch recovered-branch <sha>   # Recreate
git town set-parent main            # Set parent
```

### Reset git-town State

If git-town state is corrupted:

```bash
git town config reset  # Reset config
# Then re-run git town init
```

## Debug Mode

For verbose output:

```bash
GIT_TOWN_DEBUG=true git town sync
```

Shows all git commands being executed.

## Getting Help

```bash
git town help              # General help
git town help <command>    # Command-specific help
git town version           # Check version
```

Report issues: https://github.com/git-town/git-town/issues
