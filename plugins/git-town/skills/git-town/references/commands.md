# Command Reference

## Workflow Commands

```bash
# hack - create feature branch from main
git town hack <branch-name>
git town hack -p              # Prompt for name
git town hack --no-push       # Don't push new branch

# sync - synchronize branches
git town sync                 # Current branch
git town sync --all           # All branches
git town sync --stack         # Current and descendants
git town sync --dry-run       # Preview changes
git town sync --no-push       # Skip pushing

# propose - create pull request
git town propose              # Open PR creation page
git town propose --stack      # PRs for entire stack
git town propose --title "…"  # Set PR title
git town propose --body "…"   # Set PR body

# ship - merge completed branch
git town ship                 # Ship current branch
git town ship <branch>        # Ship specific branch
git town ship --message "…"   # Set merge commit message

# switch - change branches
git town switch               # Interactive picker
git town switch <branch>      # Switch directly
```

## Stack Commands

```bash
git town append <branch>      # Create child branch
git town prepend <branch>     # Insert branch before current
git town up                   # Move to child
git town down                 # Move to parent
git town set-parent <branch>  # Change parent
git town detach               # Make direct child of main
git town merge                # Merge into parent
git town swap                 # Swap with parent
```

## Branch Type Commands

All type commands toggle on/off:

```bash
git town contribute [branch]  # No auto-push (for repos you don't own)
git town observe [branch]     # Pull only
git town park [branch]        # Exclude from sync
git town prototype [branch]   # No push (local experimentation)
```

## Recovery Commands

```bash
git town undo                 # Reverse last command
git town continue             # Resume after resolving conflicts
git town skip                 # Skip problematic commit
git town abort                # Cancel and restore previous state
```

## Information Commands

```bash
git town status               # Show pending operation
git town branch               # Current branch details
git town branches             # All branches with hierarchy
git town diff-parent          # Diff against parent branch
```

## Configuration Commands

```bash
git town init                 # Interactive setup
git town config               # Show all settings
git town config perennial-branches add <branch>
git town config perennial-branches remove <branch>
git town completions bash|zsh|fish
git town offline [true|false] # Toggle offline mode
```

## Common Flags

| Flag | Commands | Effect |
|------|----------|--------|
| `--stack` | sync, propose | Apply to current branch and descendants |
| `--all` | sync | Apply to all branches |
| `--dry-run` | sync | Preview without changes |
| `--no-push` | hack, sync | Skip pushing |
| `-p` | hack, append, prepend | Prompt for branch name |
